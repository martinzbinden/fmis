import uuid as uuidlib

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_permission
from .db import pool

router = APIRouter(dependencies=[Depends(require_permission("users:manage"))])


class UserOut(BaseModel):
    id: str
    email: str
    status: str
    role_id: str | None
    role_name: str | None


class RoleOut(BaseModel):
    id: str
    name: str
    permissions: list[str]


class AssignRoleBody(BaseModel):
    role_id: str


class CreateRoleBody(BaseModel):
    name: str
    permissions: list[str]


@router.get("/admin/users", response_model=list[UserOut])
async def list_users() -> list[UserOut]:
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                """
                select u.id, u.email, u.status, u.role_id, r.name
                from users u
                left join roles r on r.id = u.role_id
                order by u.created_at
                """
            )
        ).fetchall()
    return [
        UserOut(id=str(r[0]), email=r[1], status=r[2], role_id=str(r[3]) if r[3] else None, role_name=r[4])
        for r in rows
    ]


@router.post("/admin/users/{user_id}/role")
async def assign_role(user_id: str, body: AssignRoleBody) -> dict[str, str]:
    async with pool.connection() as conn:
        result = await conn.execute(
            "update users set role_id = %s, status = 'active' where id = %s",
            (body.role_id, user_id),
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
        await conn.commit()
    return {"status": "ok"}


@router.post("/admin/users/{user_id}/disable")
async def disable_user(user_id: str) -> dict[str, str]:
    async with pool.connection() as conn:
        result = await conn.execute("update users set status = 'disabled' where id = %s", (user_id,))
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
        await conn.commit()
    return {"status": "ok"}


@router.post("/admin/users/{user_id}/enable")
async def enable_user(user_id: str) -> dict[str, str]:
    async with pool.connection() as conn:
        result = await conn.execute(
            "update users set status = 'active' where id = %s and role_id is not null",
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
