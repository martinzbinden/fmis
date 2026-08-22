import hashlib
import os
import secrets
import uuid as uuidlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr

from .db import pool
from .email import send_magic_link

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "365"))
MAGIC_LINK_TTL_MINUTES = 30
INITIAL_ADMIN_EMAIL = os.environ.get("INITIAL_ADMIN_EMAIL", "").strip().lower()
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:5173").rstrip("/")
ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001"
# Nur für Test-/Entwicklungsumgebungen: wenn gesetzt, kann man sich per
# Passwort direkt als INITIAL_ADMIN_EMAIL einloggen, ohne Magic-Link/E-Mail.
# In Produktion NIE setzen — leer/unset deaktiviert diesen Weg komplett.
TEST_LOGIN_PASSWORD = os.environ.get("TEST_LOGIN_PASSWORD", "").strip()

router = APIRouter()
bearer_scheme = HTTPBearer()


class RequestLinkBody(BaseModel):
    email: EmailStr


class VerifyBody(BaseModel):
    token: str


class PasswordLoginBody(BaseModel):
    password: str


class VerifyResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


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


@router.post("/auth/request-link")
async def request_link(body: RequestLinkBody) -> dict[str, str]:
    email = body.email.lower().strip()
    async with pool.connection() as conn:
        row = await (
            await conn.execute("select id from users where email = %s", (email,))
        ).fetchone()
        if row:
            user_id = row[0]
        else:
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

        # Ältere, noch unbenutzte Links für diesen Nutzer invalidieren — es soll
        # immer nur der zuletzt angeforderte Link gültig sein.
        await conn.execute(
            "update login_tokens set used_at = now() where user_id = %s and used_at is null",
            (user_id,),
        )

        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=MAGIC_LINK_TTL_MINUTES)
        await conn.execute(
            "insert into login_tokens (id, user_id, token_hash, expires_at) values (%s, %s, %s, %s)",
            (str(uuidlib.uuid4()), user_id, _hash_token(token), expires_at),
        )
        await conn.commit()

    link = f"{PUBLIC_URL}/verify?token={token}"
    await send_magic_link(email, link)
    # Immer dieselbe Antwort, unabhängig davon ob die Adresse neu/bekannt/gesperrt
    # ist — verhindert, dass sich per Login-Formular Nutzerkonten aufzählen lassen.
    return {"message": "Falls die Adresse bekannt ist, wurde ein Login-Link verschickt."}


@router.post("/auth/verify", response_model=VerifyResponse)
async def verify(body: VerifyBody) -> VerifyResponse:
    token_hash = _hash_token(body.token)
    async with pool.connection() as conn:
        # Atomar prüfen+verbrauchen (UPDATE...WHERE used_at is null RETURNING),
        # statt SELECT dann UPDATE — sonst können zwei nahezu gleichzeitige
        # Requests (z.B. React StrictMode-Doppel-Effect, Doppelklick) beide den
        # "noch nicht benutzt"-Zustand sehen, bevor einer von beiden committet.
        row = await (
            await conn.execute(
                """
                update login_tokens set used_at = now()
                where token_hash = %s and used_at is null
                returning user_id, expires_at
                """,
                (token_hash,),
            )
        ).fetchone()

        if row is None:
            exists = await (
                await conn.execute(
                    "select 1 from login_tokens where token_hash = %s", (token_hash,)
                )
            ).fetchone()
            await conn.commit()
            if exists:
                raise HTTPException(status_code=401, detail="Link wurde bereits verwendet")
            raise HTTPException(status_code=401, detail="Ungültiger Link")

        user_id, expires_at = row
        if expires_at < datetime.now(timezone.utc):
            await conn.commit()
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
    # Admin-Aktionen (Rolle ändern, Nutzer sperren) wirken so sofort, ohne
    # Token-Blacklist verwalten zu müssen.
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
