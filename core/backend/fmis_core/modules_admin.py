from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import CurrentUser, require_auth, require_permission
from .db import get_pool
from .module_registry import MODULE_SPECS

router = APIRouter(prefix="/core")

pool = get_pool("public")

_KNOWN_KEYS = {spec.key for spec in MODULE_SPECS}


class ModuleOut(BaseModel):
    key: str
    title: str
    enabled: bool


class SetEnabledBody(BaseModel):
    enabled: bool


@router.get("/modules", response_model=list[ModuleOut])
async def list_modules(user: CurrentUser = Depends(require_auth)) -> list[ModuleOut]:
    """Jeder eingeloggte Nutzer darf die Modulliste sehen — das Frontend ruft
    dies einmal nach dem Login auf, um Navigation/Routen nur für aktuell
    aktivierte Module zu bauen (siehe core/frontend, Phase 2)."""
    async with pool.connection() as conn:
        rows = await (
            await conn.execute("select key, title, enabled from modules order by key")
        ).fetchall()
    return [ModuleOut(key=r[0], title=r[1], enabled=r[2]) for r in rows]


@router.patch("/modules/{key}", response_model=ModuleOut)
async def set_module_enabled(
    key: str,
    body: SetEnabledBody,
    user: CurrentUser = Depends(require_permission("core:modules:manage")),
) -> ModuleOut:
    if key not in _KNOWN_KEYS:
        raise HTTPException(status_code=404, detail="Unbekanntes Modul")
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                "update modules set enabled = %s, updated_at = now() where key = %s "
                "returning key, title, enabled",
                (body.enabled, key),
            )
        ).fetchone()
        await conn.commit()
    if row is None:
        raise HTTPException(status_code=404, detail="Unbekanntes Modul")
    return ModuleOut(key=row[0], title=row[1], enabled=row[2])


def require_module_enabled(key: str):
    """Analog zu require_permission (auth.py) — wird an jeden gemounteten
    Modul-Router gehängt (siehe backend/app/main.py), damit ein via
    PATCH /core/modules/{key} deaktiviertes Modul dessen Sync-Endpunkte
    sofort ablehnt, ganz ohne Neustart/Redeploy (gleiches "bei jedem
    Request frisch aus der DB lesen"-Muster wie Rollenänderungen in
    require_auth)."""

    async def checker(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        async with pool.connection() as conn:
            row = await (
                await conn.execute("select enabled from modules where key = %s", (key,))
            ).fetchone()
        if row is None or not row[0]:
            raise HTTPException(status_code=403, detail=f"Modul '{key}' ist deaktiviert")
        return user

    return checker
