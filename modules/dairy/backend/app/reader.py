import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from core.backend.fmis_core.agrident import ReaderBusyError, acquire_reader, sheep_short_tag
from core.backend.fmis_core.auth import CurrentUser, require_auth, require_permission
from core.backend.fmis_core.db import get_pool
from core.backend.fmis_core.modules_admin import get_reader_settings, is_reader_enabled, require_reader_enabled


def build_reader_router(key: str) -> APIRouter:
    """Baut den APR600-Router für EINE Instanz dieses Moduls (analog zu
    sync.py's build_router) — Live-Melkliste während der Milchwägung.

    Rein transient: es wird nichts in die Datenbank geschrieben, nur beim
    Scan die Ohrmarke gegen die bereits vorhandenen `animals` dieser
    Instanz aufgelöst (siehe project_apr600_ear_tag_reader Memory: "nur
    zeitliche Reihenfolge", keine Kanal-/Standplatz-Nummer verfügbar)."""
    pool = get_pool(key)
    router = APIRouter()

    @router.get("/reader/status")
    async def status(user: CurrentUser = Depends(require_auth)) -> dict[str, bool]:
        return {"enabled": await is_reader_enabled(key)}

    @router.get("/reader/live")
    async def live(
        user: CurrentUser = Depends(require_permission(f"{key}:animals:read")),
        _reader_ok: CurrentUser = Depends(require_reader_enabled(key)),
    ) -> StreamingResponse:
        host, port = await get_reader_settings(key)

        async def event_stream():
            seen: dict[str, int] = {}
            try:
                async with acquire_reader(host, port, keepalive=True) as conn:
                    async for long_tag in conn.live_reads():
                        if long_tag in seen:
                            continue
                        position = len(seen) + 1
                        seen[long_tag] = position
                        candidate = sheep_short_tag(long_tag) or long_tag
                        animal = await _find_animal(pool, candidate)
                        if animal is None and candidate != long_tag:
                            animal = await _find_animal(pool, long_tag)
                        event = {
                            "ear_tag": candidate,
                            "matched": animal is not None,
                            "name": animal[1] if animal else None,
                            "position": position,
                        }
                        yield f"data: {json.dumps(event)}\n\n"
            except ReaderBusyError as exc:
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    return router


async def _find_animal(pool, ear_tag: str):
    async with pool.connection() as conn:
        return await (
            await conn.execute(
                "select id, name from animals where ear_tag = %s and deleted_at is null", (ear_tag,)
            )
        ).fetchone()
