import hashlib
import os
import secrets
import uuid as uuidlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr

from .db import get_pool
from .email import send_magic_link

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "365"))
# Der Login-Link selbst ist persistent (kann z.B. als Homescreen-Shortcut
# gespeichert und beliebig oft geklickt werden), nicht nur ein kurzlebiger
# Einmal-Code — verwendet dieselbe Gültigkeitsdauer wie die Session.
MAGIC_LINK_TTL_DAYS = SESSION_TTL_DAYS
INITIAL_ADMIN_EMAIL = os.environ.get("INITIAL_ADMIN_EMAIL", "").strip().lower()
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:5173").rstrip("/")
ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001"
# Nur für Test-/Entwicklungsumgebungen: wenn gesetzt, kann man sich per
# Passwort direkt als INITIAL_ADMIN_EMAIL einloggen, ohne Magic-Link/E-Mail.
# In Produktion NIE setzen — leer/unset deaktiviert diesen Weg komplett.
TEST_LOGIN_PASSWORD = os.environ.get("TEST_LOGIN_PASSWORD", "").strip()
# Domains, deren Adressen sich selbst einen Login-Link schicken lassen duerfen,
# ohne vorher in "users" zu stehen (z.B. "riedackerhof.ch"). Alle uebrigen
# Adressen bekommen nur dann einen Link, wenn sie bereits erfasst sind —
# freigeschaltet werden sie so oder so erst durch einen Admin.
LOGIN_DOMAINS = {
    d.strip().lower().lstrip("@")
    for d in os.environ.get("LOGIN_DOMAINS", "").split(",")
    if d.strip()
}
# Anmeldung über das vorgelagerte Portal (Authelia ForwardAuth): Traefik setzt
# dann den Kopf Remote-Email, und /auth/sso tauscht ihn gegen ein fmis-Token.
#
# NUR einschalten, wo genau dieser Pfad auch hinter der ForwardAuth-Middleware
# liegt — siehe Router "fmis-sso" in docker-compose.yml. Der API-Router läuft
# bewusst ohne ForwardAuth; käme /auth/sso dort an, könnte jeder den Kopf
# selbst mitschicken und sich ein Token für eine fremde Adresse ausstellen.
SSO_ENABLED = os.environ.get("SSO_ENABLED", "").strip().lower() == "true"
SSO_EMAIL_HEADER = os.environ.get("SSO_EMAIL_HEADER", "Remote-Email").strip()

router = APIRouter()
bearer_scheme = HTTPBearer()

pool = get_pool("public")


class RequestLinkBody(BaseModel):
    email: EmailStr


class VerifyBody(BaseModel):
    token: str


class PasswordLoginBody(BaseModel):
    password: str


class VerifyResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AuthConfigResponse(BaseModel):
    password_login: bool
    sso: bool


class MeResponse(BaseModel):
    email: str
    role: str | None
    permissions: list[str]


@dataclass
class CurrentUser:
    id: str
    email: str
    role: str | None
    permissions: set[str]


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _issue_session_jwt(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, JWT_SECRET, algorithm=JWT_ALGORITHM)


# Immer dieselbe Antwort, unabhängig davon ob die Adresse neu/bekannt/gesperrt
# oder gar nicht zugelassen ist — verhindert, dass sich per Login-Formular
# Nutzerkonten aufzählen lassen.
LINK_REQUESTED_MESSAGE = {
    "message": "Falls die Adresse bekannt ist, wurde ein Login-Link verschickt."
}


async def _find_or_create_user(conn, email: str) -> str | None:
    """Nutzer-ID zu einer Adresse. Ist sie unbekannt, wird sie nur dann
    angelegt, wenn ihre Domain in LOGIN_DOMAINS steht (oder es die
    Bootstrap-Admin-Adresse ist) — sonst None, ohne jede Spur in der
    Benutzerliste. Freigeschaltet wird eine neue Zeile so oder so erst durch
    einen Admin (status 'pending')."""
    row = await (
        await conn.execute("select id from users where email = %s", (email,))
    ).fetchone()
    if row:
        return row[0]

    domain = email.rpartition("@")[2]
    if domain not in LOGIN_DOMAINS and email != INITIAL_ADMIN_EMAIL:
        return None

    user_id = str(uuidlib.uuid4())
    is_bootstrap_admin = bool(INITIAL_ADMIN_EMAIL) and email == INITIAL_ADMIN_EMAIL
    await conn.execute(
        "insert into users (id, email, role_id, status) values (%s, %s, %s, %s)",
        (
            user_id,
            email,
            ADMIN_ROLE_ID if is_bootstrap_admin else None,
            "active" if is_bootstrap_admin else "pending",
        ),
    )
    return user_id


@router.post("/auth/request-link")
async def request_link(body: RequestLinkBody) -> dict[str, str]:
    email = body.email.lower().strip()
    async with pool.connection() as conn:
        user_id = await _find_or_create_user(conn, email)
        if user_id is None:
            # Unbekannte Adresse ausserhalb der eigenen Domain: kein Link und
            # kein Eintrag — sonst könnte sich jeder im Internet in die
            # Benutzerliste schreiben. Die Antwort bleibt trotzdem dieselbe.
            return LINK_REQUESTED_MESSAGE

        # Ältere Links für diesen Nutzer invalidieren ("used_at" = durch einen
        # neueren Link ersetzt, nicht "angeklickt") — es soll immer nur der
        # zuletzt angeforderte Link gültig sein.
        await conn.execute(
            "update login_tokens set used_at = now() where user_id = %s and used_at is null",
            (user_id,),
        )

        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=MAGIC_LINK_TTL_DAYS)
        await conn.execute(
            "insert into login_tokens (id, user_id, token_hash, expires_at) values (%s, %s, %s, %s)",
            (str(uuidlib.uuid4()), user_id, _hash_token(token), expires_at),
        )
        await conn.commit()

    link = f"{PUBLIC_URL}/verify?token={token}"
    await send_magic_link(email, link)
    return LINK_REQUESTED_MESSAGE


@router.post("/auth/verify", response_model=VerifyResponse)
async def verify(body: VerifyBody) -> VerifyResponse:
    """Der Link ist persistent und NICHT einmalig — er darf beliebig oft
    (z.B. als gespeichertes Lesezeichen) verwendet werden, bis er abläuft
    (MAGIC_LINK_TTL_DAYS) oder durch einen neu angeforderten Link ersetzt wird
    (used_at wird dann in request_link() gesetzt, nicht hier)."""
    token_hash = _hash_token(body.token)
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                "select user_id, expires_at from login_tokens "
                "where token_hash = %s and used_at is null",
                (token_hash,),
            )
        ).fetchone()

        if row is None:
            raise HTTPException(
                status_code=401,
                detail="Link ist ungültig oder wurde durch einen neueren Link ersetzt",
            )

        user_id, expires_at = row
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Link ist abgelaufen, bitte neu anfordern")

        user_row = await (
            await conn.execute("select status from users where id = %s", (user_id,))
        ).fetchone()
        await conn.execute("update users set last_login_at = now() where id = %s", (user_id,))
        await conn.commit()

    if user_row is None or user_row[0] != "active":
        raise HTTPException(
            status_code=403, detail="Konto wartet auf Freischaltung durch einen Admin"
        )

    return VerifyResponse(access_token=_issue_session_jwt(user_id))


@router.get("/auth/config", response_model=AuthConfigResponse)
async def auth_config() -> AuthConfigResponse:
    """Was das Login-Formular anbieten darf. Der Passwort-Login existiert nur
    in Test-/Entwicklungsumgebungen (TEST_LOGIN_PASSWORD gesetzt), SSO nur
    hinter einem Portal; wo es den Weg nicht gibt, soll die Oberfläche ihn gar
    nicht erst anzeigen. Verrät nichts Vertrauliches — nur, welche Wege offen
    sind."""
    return AuthConfigResponse(password_login=bool(TEST_LOGIN_PASSWORD), sso=SSO_ENABLED)


@router.get("/auth/portal")
async def portal_entry() -> RedirectResponse:
    """Weg zurück ins Portal für eine App, die schon im Browser-Cache liegt.

    Die installierte PWA holt ihre Hülle aus dem Service-Worker-Cache — die
    Navigation geht gar nicht erst ins Netz, und Authelia bekommt sie nie zu
    sehen. Ohne Portal-Sitzung hat /auth/sso dann nichts zu übernehmen, und der
    Anwender landet auf dem E-Mail-Formular, statt einfach angemeldet zu sein.

    Dieser Pfad liegt hinter derselben ForwardAuth und steht in der
    navigateFallbackDenylist des Service-Workers (siehe vite.config.ts), wird
    also wirklich aus dem Netz geholt: Authelia leitet auf die Anmeldeseite,
    danach kommt man hier heraus und wird in die App zurückgeschickt — jetzt
    mit gültiger Sitzung.
    """
    if not SSO_ENABLED:
        raise HTTPException(status_code=404, detail="SSO ist hier nicht eingerichtet")
    return RedirectResponse(url=f"{PUBLIC_URL}/", status_code=302)


@router.post("/auth/sso", response_model=VerifyResponse)
async def sso_login(request: Request) -> VerifyResponse:
    """Tauscht die Anmeldung am vorgelagerten Portal gegen ein fmis-Token, damit
    man sich nicht zweimal anmeldet. Der Kopf Remote-Email stammt aus Authelias
    ForwardAuth-Antwort; die Middleware-Kette entfernt vorher eine vom Client
    mitgeschickte Fassung.

    Sicherheitsvoraussetzung: Dieser Pfad MUSS über einen eigenen Traefik-Router
    mit der ForwardAuth-Middleware laufen (Router "fmis-sso" in
    docker-compose.yml, Priorität über dem API-Router). Sonst landet die
    Anfrage beim ungeschützten API-Router, und der Kopf wäre frei erfindbar.
    Deshalb ist SSO_ENABLED standardmässig aus und gehört nur dort gesetzt, wo
    dieser Router existiert.
    """
    if not SSO_ENABLED:
        raise HTTPException(status_code=404, detail="SSO ist hier nicht eingerichtet")

    email = (request.headers.get(SSO_EMAIL_HEADER) or "").lower().strip()
    if not email:
        raise HTTPException(status_code=401, detail="Keine Portal-Anmeldung erkannt")

    async with pool.connection() as conn:
        user_id = await _find_or_create_user(conn, email)
        if user_id is None:
            raise HTTPException(status_code=403, detail="Adresse ist für FMIS nicht zugelassen")

        status_row = await (
            await conn.execute("select status from users where id = %s", (user_id,))
        ).fetchone()
        await conn.execute("update users set last_login_at = now() where id = %s", (user_id,))
        await conn.commit()

    if status_row is None or status_row[0] != "active":
        raise HTTPException(
            status_code=403, detail="Konto wartet auf Freischaltung durch einen Admin"
        )

    return VerifyResponse(access_token=_issue_session_jwt(user_id))


@router.post("/auth/password-login", response_model=VerifyResponse)
async def password_login(body: PasswordLoginBody) -> VerifyResponse:
    """Nur für Test-/Entwicklungsumgebungen (TEST_LOGIN_PASSWORD gesetzt) —
    loggt direkt als INITIAL_ADMIN_EMAIL ein, ohne Magic-Link/E-Mail-Versand.
    In Produktion ist TEST_LOGIN_PASSWORD leer, der Endpunkt lehnt dann immer ab.
    """
    if not TEST_LOGIN_PASSWORD or body.password != TEST_LOGIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Ungültiges Passwort")
    if not INITIAL_ADMIN_EMAIL:
        raise HTTPException(status_code=500, detail="INITIAL_ADMIN_EMAIL ist nicht konfiguriert")

    async with pool.connection() as conn:
        row = await (
            await conn.execute("select id from users where email = %s", (INITIAL_ADMIN_EMAIL,))
        ).fetchone()
        if row:
            user_id = row[0]
            await conn.execute(
                "update users set last_login_at = now() where id = %s", (user_id,)
            )
        else:
            user_id = str(uuidlib.uuid4())
            await conn.execute(
                "insert into users (id, email, role_id, status, last_login_at) "
                "values (%s, %s, %s, 'active', now())",
                (user_id, INITIAL_ADMIN_EMAIL, ADMIN_ROLE_ID),
            )
        await conn.commit()

    return VerifyResponse(access_token=_issue_session_jwt(user_id))


async def require_auth(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> CurrentUser:
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Ungültiges oder abgelaufenes Token")

    user_id = payload.get("sub")
    # Rolle/Status werden bei JEDEM Request frisch geladen (kein Claim im JWT) —
    # Admin-Aktionen (Rolle ändern, Nutzer sperren, Modul deaktivieren) wirken
    # so sofort, ohne Token-Blacklist verwalten zu müssen.
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                """
                select u.email, u.status, r.name, r.permissions
                from users u
                left join roles r on r.id = u.role_id
                where u.id = %s
                """,
                (user_id,),
            )
        ).fetchone()

    if row is None or row[1] != "active":
        raise HTTPException(status_code=401, detail="Konto nicht aktiv")

    email, _status, role_name, permissions = row
    return CurrentUser(id=user_id, email=email, role=role_name, permissions=set(permissions or []))


def require_permission(permission: str):
    async def checker(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        if permission not in user.permissions:
            raise HTTPException(status_code=403, detail=f"Fehlende Berechtigung: {permission}")
        return user

    return checker


@router.get("/auth/me", response_model=MeResponse)
async def me(user: CurrentUser = Depends(require_auth)) -> MeResponse:
    return MeResponse(email=user.email, role=user.role, permissions=sorted(user.permissions))
