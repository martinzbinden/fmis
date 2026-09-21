from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import CurrentUser, require_auth, require_permission
from .db import get_pool
from .module_registry import MODULE_SPECS

router = APIRouter(prefix="/core")

pool = get_pool("public")

_KNOWN_KEYS = {spec.key for spec in MODULE_SPECS}
# Module-SOURCES (nicht Keys — gilt für jede Instanz), die eine APR600-
# Leser-Anbindung haben können (siehe agrident.py). Nur diese bekommen im
# Admin-UI den Leser-Umschalter angezeigt.
_READER_CAPABLE_SOURCES = {"dairy", "livestock"}
_READER_CAPABLE_KEYS = {spec.key for spec in MODULE_SPECS if spec.source in _READER_CAPABLE_SOURCES}


class ReaderOut(BaseModel):
    enabled: bool
    host: str
    port: int


class ModuleOut(BaseModel):
    key: str
    title: str
    enabled: bool
    reader_capable: bool
    reader: ReaderOut | None = None


class SetEnabledBody(BaseModel):
    enabled: bool


class SetReaderBody(BaseModel):
    enabled: bool
    host: str
    port: int


@router.get("/modules", response_model=list[ModuleOut])
async def list_modules(user: CurrentUser = Depends(require_auth)) -> list[ModuleOut]:
    """Jeder eingeloggte Nutzer darf die Modulliste sehen — das Frontend ruft
    dies einmal nach dem Login auf, um Navigation/Routen nur für aktuell
    aktivierte Module zu bauen (siehe core/frontend, Phase 2)."""
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                """
                select m.key, m.title, m.enabled, r.enabled, r.host, r.port
                from modules m
                left join reader_settings r on r.module_key = m.key
                order by m.key
                """
            )
        ).fetchall()
    result = []
    for key, title, enabled, r_enabled, r_host, r_port in rows:
        reader = None
        if key in _READER_CAPABLE_KEYS and r_enabled is not None:
            reader = ReaderOut(enabled=r_enabled, host=r_host, port=r_port)
        result.append(
            ModuleOut(key=key, title=title, enabled=enabled, reader_capable=key in _READER_CAPABLE_KEYS, reader=reader)
        )
    return result


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
    return ModuleOut(key=row[0], title=row[1], enabled=row[2], reader_capable=row[0] in _READER_CAPABLE_KEYS)


@router.patch("/modules/{key}/reader", response_model=ReaderOut)
async def set_reader_settings(
    key: str,
    body: SetReaderBody,
    user: CurrentUser = Depends(require_permission("core:modules:manage")),
) -> ReaderOut:
    if key not in _READER_CAPABLE_KEYS:
        raise HTTPException(status_code=404, detail="Modul hat keine Leser-Anbindung")
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                """
                insert into reader_settings (module_key, enabled, host, port, updated_at)
                values (%s, %s, %s, %s, now())
                on conflict (module_key) do update set
                  enabled = excluded.enabled, host = excluded.host, port = excluded.port,
                  updated_at = now()
                returning enabled, host, port
                """,
                (key, body.enabled, body.host, body.port),
            )
        ).fetchone()
        await conn.commit()
    return ReaderOut(enabled=row[0], host=row[1], port=row[2])


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


def require_reader_enabled(key: str):
    """Analog zu require_module_enabled, aber für den APR600-Leser-
    Umschalter EINER Instanz (siehe reader_settings) — 403 wenn der Leser
    für dieses Modul (noch) nicht aktiviert wurde, unabhängig davon ob das
    Modul selbst aktiv ist (das prüft require_module_enabled bereits separat)."""

    async def checker(user: CurrentUser = Depends(require_auth)) -> CurrentUser:
        async with pool.connection() as conn:
            row = await (
                await conn.execute(
                    "select enabled from reader_settings where module_key = %s", (key,)
                )
            ).fetchone()
        if row is None or not row[0]:
            raise HTTPException(status_code=403, detail=f"Leser für '{key}' ist nicht aktiviert")
        return user

    return checker


async def is_reader_enabled(key: str) -> bool:
    """Reine Lesehilfe für /reader/status-Endpunkte (kein 403, nur ein
    Boolean) — require_reader_enabled() ist für Endpunkte gedacht, die bei
    deaktiviertem Leser hart ablehnen sollen."""
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                "select enabled from reader_settings where module_key = %s", (key,)
            )
        ).fetchone()
    return bool(row and row[0])


async def get_reader_settings(key: str) -> tuple[str, int]:
    """Holt Adresse/Port für den Leser EINER Instanz — von den Reader-Routern
    (modules/dairy/backend/app/reader.py, modules/livestock/backend/app/reader.py)
    vor jedem Verbindungsversuch frisch aus der DB gelesen, damit eine
    Adress-Änderung im Admin-UI ohne Neustart wirkt."""
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                "select host, port from reader_settings where module_key = %s", (key,)
            )
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Keine Leser-Einstellungen für '{key}'")
    return row[0], row[1]
