import uuid as uuidlib

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_permission
from .db import get_pool

router = APIRouter(dependencies=[Depends(require_permission("core:users:manage"))])

pool = get_pool("public")


class UserOut(BaseModel):
    id: str
    email: str
    status: str
    role_id: str | None
    role_name: str | None
    # per Authelia-Gruppe verwaltet (Rolle/Sperre werden bei der Anmeldung nachgeführt)
    sso_managed: bool = False
    # zuletzt gesehene Authelia-Gruppen
    sso_groups: str | None = None


class RoleOut(BaseModel):
    id: str
    name: str
    permissions: list[str]


class AssignRoleBody(BaseModel):
    role_id: str


class CreateRoleBody(BaseModel):
    name: str
    permissions: list[str]


class CreateUserBody(BaseModel):
    email: str
    role_id: str | None = None


@router.post("/admin/users", response_model=UserOut)
async def create_user(body: CreateUserBody) -> UserOut:
    """Person vorab erfassen, bevor sie sich erstmals anmeldet.

    Ohne Rolle: wartend und «über Authelia» verwaltet — beim ersten Portal-Login
    gilt die Rolle der Authelia-Gruppe (ohne passende Gruppe bleibt das Konto
    gesperrt). Mit Rolle: sofort aktiv, von Hand vergeben (keine Nachführung
    durch die Gruppe)."""
    email = body.email.strip().lower()
    if "@" not in email or any(c.isspace() for c in email) or email.startswith("@") or email.endswith("@"):
        raise HTTPException(status_code=400, detail="Ungültige E-Mail-Adresse")
    user_id = str(uuidlib.uuid4())
    manual = body.role_id is not None
    async with pool.connection() as conn:
        exists = await (await conn.execute("select 1 from users where email = %s", (email,))).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="Diese Adresse ist schon erfasst")
        try:
            await conn.execute(
                "insert into users (id, email, role_id, status, sso_managed) values (%s, %s, %s, %s, %s)",
                (user_id, email, body.role_id, "active" if manual else "pending", not manual),
            )
        except Exception as exc:
            await conn.rollback()
            raise HTTPException(status_code=400, detail="Rolle unbekannt") from exc
        row = await (
            await conn.execute(
                "select u.id, u.email, u.status, u.role_id, r.name, u.sso_managed, u.sso_groups "
                "from users u left join roles r on r.id = u.role_id where u.id = %s",
                (user_id,),
            )
        ).fetchone()
        await conn.commit()
    return UserOut(
        id=str(row[0]), email=row[1], status=row[2], role_id=str(row[3]) if row[3] else None, role_name=row[4],
        sso_managed=bool(row[5]), sso_groups=row[6],
    )


@router.get("/admin/users", response_model=list[UserOut])
async def list_users() -> list[UserOut]:
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                """
                select u.id, u.email, u.status, u.role_id, r.name, u.sso_managed, u.sso_groups
                from users u
                left join roles r on r.id = u.role_id
                order by u.created_at
                """
            )
        ).fetchall()
    return [
        UserOut(
            id=str(r[0]), email=r[1], status=r[2], role_id=str(r[3]) if r[3] else None, role_name=r[4],
            sso_managed=bool(r[5]), sso_groups=r[6],
        )
        for r in rows
    ]


class UserViewOut(BaseModel):
    email: str
    role: str | None
    permissions: list[str]


@router.get("/admin/users/{user_id}/view", response_model=UserViewOut)
async def user_view(user_id: str) -> UserViewOut:
    """Rechte eines Nutzers, damit ein Admin die App «mit seinen Augen» sehen
    kann (Ansicht wechseln). Nur lesend: der Admin bleibt mit dem eigenen Token
    angemeldet, es entsteht keine fremde Sitzung und nichts wird unter dem
    Namen des Nutzers gespeichert."""
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                """
                select u.email, u.status, r.name, r.permissions
                from users u left join roles r on r.id = u.role_id
                where u.id = %s
                """,
                (user_id,),
            )
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    if row[1] != "active":
        raise HTTPException(status_code=409, detail="Nutzer ist nicht aktiv")
    return UserViewOut(email=row[0], role=row[2], permissions=sorted(row[3] or []))


@router.post("/admin/users/{user_id}/role")
async def assign_role(user_id: str, body: AssignRoleBody) -> dict[str, str]:
    async with pool.connection() as conn:
        result = await conn.execute(
            "update users set role_id = %s, status = 'active', sso_managed = false where id = %s",
            (body.role_id, user_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
        await conn.commit()
    return {"status": "ok"}


@router.post("/admin/users/{user_id}/disable")
async def disable_user(user_id: str) -> dict[str, str]:
    async with pool.connection() as conn:
        result = await conn.execute("update users set status = 'disabled', sso_managed = false where id = %s", (user_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
        await conn.commit()
    return {"status": "ok"}


@router.post("/admin/users/{user_id}/enable")
async def enable_user(user_id: str) -> dict[str, str]:
    async with pool.connection() as conn:
        result = await conn.execute(
            "update users set status = 'active', sso_managed = false where id = %s and role_id is not null",
            (user_id,),
        )
        if result.rowcount == 0:
            raise HTTPException(
                status_code=409, detail="Nutzer hat keine Rolle oder existiert nicht"
            )
        await conn.commit()
    return {"status": "ok"}


@router.get("/admin/roles", response_model=list[RoleOut])
async def list_roles() -> list[RoleOut]:
    async with pool.connection() as conn:
        rows = await (
            await conn.execute("select id, name, permissions from roles order by name")
        ).fetchall()
    return [RoleOut(id=str(r[0]), name=r[1], permissions=r[2] or []) for r in rows]


@router.post("/admin/roles", response_model=RoleOut)
async def create_role(body: CreateRoleBody) -> RoleOut:
    role_id = str(uuidlib.uuid4())
    async with pool.connection() as conn:
        try:
            await conn.execute(
                "insert into roles (id, name, permissions) values (%s, %s, %s)",
                (role_id, body.name, body.permissions),
            )
        except Exception as exc:
            raise HTTPException(status_code=409, detail="Rollenname bereits vergeben") from exc
        await conn.commit()
    return RoleOut(id=role_id, name=body.name, permissions=body.permissions)


class SsoGroupRole(BaseModel):
    group_name: str
    role_id: str


@router.get("/admin/sso-groups", response_model=list[SsoGroupRole])
async def list_sso_groups() -> list[SsoGroupRole]:
    async with pool.connection() as conn:
        rows = await (
            await conn.execute("select group_name, role_id from sso_group_roles order by lower(group_name)")
        ).fetchall()
    return [SsoGroupRole(group_name=r[0], role_id=str(r[1])) for r in rows]


@router.put("/admin/sso-groups", response_model=list[SsoGroupRole])
async def save_sso_groups(body: list[SsoGroupRole]) -> list[SsoGroupRole]:
    """Zuordnung Authelia-Gruppe → Rolle ersetzen. Wirkt bei der nächsten
    Anmeldung der Betroffenen (die App prüft alle 6 Stunden im Hintergrund)."""
    names = [g.group_name.strip() for g in body]
    if any(not n for n in names):
        raise HTTPException(status_code=400, detail="Gruppenname fehlt")
    if len({n.lower() for n in names}) != len(names):
        raise HTTPException(status_code=400, detail="Jede Gruppe nur einmal")
    async with pool.connection() as conn:
        try:
            await conn.execute("delete from sso_group_roles")
            for n, g in zip(names, body):
                await conn.execute("insert into sso_group_roles (group_name, role_id) values (%s, %s)", (n, g.role_id))
        except Exception as exc:
            await conn.rollback()
            raise HTTPException(status_code=400, detail="Rolle unbekannt") from exc
        await conn.commit()
    return [SsoGroupRole(group_name=n, role_id=g.role_id) for n, g in zip(names, body)]
