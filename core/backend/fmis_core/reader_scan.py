"""Zentrale Leser-Funktion für Erfassungsformulare: `GET /core/reader/scan`
streamt (SSE) jede gelesene Ohrmarke, solange der Browser zuhört — es wird
nichts geschrieben, das Formular entscheidet selbst, was mit einer Lesung
passiert (Gegenstück im Frontend: core/frontend/src/tagReader.ts).

Welcher Leser? Es gibt nur ein physisches Gerät; die Adresse steht je
Modul-Instanz in `reader_settings`. Hat das Modul der Seite eine eigene
Zeile, gilt deren Umschalter (der Admin kann den Leser für eine Instanz
bewusst ausschalten). Module ohne Leser-Einstellung (z.B. tiere) nehmen den
ersten aktivierten Leser.

Die Milchwägung (modules/dairy/backend/app/reader.py) hält das Gerät über
dieselbe Sperre (acquire_reader) — während einer Wägung meldet der Scan
«belegt»."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from .agrident import ReaderBusyError, ReaderError, acquire_reader, reader_tag_candidates
from .auth import CurrentUser, require_auth
from .db import get_pool

router = APIRouter(prefix="/core")

pool = get_pool("public")


async def resolve_reader(module: str) -> tuple[str, str, int] | None:
    """(module_key der Einstellung, host, port) oder None, wenn kein Leser verfügbar ist."""
    async with pool.connection() as conn:
        own = await (
            await conn.execute("select enabled, host, port from reader_settings where module_key = %s", (module,))
        ).fetchone()
        if own is not None:
            return (module, own[1], own[2]) if own[0] else None
        row = await (
            await conn.execute("select module_key, host, port from reader_settings where enabled order by module_key limit 1")
        ).fetchone()
    return (row[0], row[1], row[2]) if row else None


def _can_write(user: CurrentUser) -> bool:
    return any(p.endswith(":write") for p in user.permissions)


def scan_response(host: str, port: int, lookup: Callable[[str], Awaitable[dict]]) -> StreamingResponse:
    """SSE-Antwort: {ready} sobald der Leser antwortet, je Lesung lookup(long_tag),
    {error} bei Problemen, {closed} am Ende. Schliesst der Browser die Verbindung,
    wird das Gerät sofort freigegeben."""

    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    async def stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def pump() -> None:
            try:
                async with acquire_reader(host, port, keepalive=True) as conn:
                    try:
                        await conn.send_command("XGMEMINFO", timeout=5.0)
                    except ReaderError as exc:
                        await queue.put({"error": f"Der Leser antwortet nicht ({exc}) — AgriLink-/WLAN-Modus am Gerät prüfen"})
                        return
                    await queue.put({"ready": True})
                    async for long_tag in conn.live_reads():
                        await queue.put(await lookup(long_tag))
            except asyncio.CancelledError:
                raise
            except ReaderBusyError:
                await queue.put({"error": "Lesegerät ist belegt (Milchwägung oder anderes Gerät) — dort zuerst trennen"})
            except (ReaderError, OSError) as exc:
                await queue.put({"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                await queue.put({"error": f"Unerwarteter Fehler: {exc}"})
            await queue.put({"closed": True})

        task = asyncio.create_task(pump())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"  # Heartbeat gegen Proxy-Timeouts
                    continue
                yield sse(item)
                if "closed" in item:
                    return
        finally:
            task.cancel()  # Browser weg: Leser freigeben

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/reader/status")
async def status(module: str = Query(...), user: CurrentUser = Depends(require_auth)) -> dict:
    resolved = await resolve_reader(module)
    return {"enabled": resolved is not None and _can_write(user), "reader_module": resolved[0] if resolved else None}


@router.get("/reader/scan")
async def scan(module: str = Query(...), user: CurrentUser = Depends(require_auth)) -> StreamingResponse:
    if not _can_write(user):
        raise HTTPException(status_code=403, detail="Keine Schreibberechtigung")
    resolved = await resolve_reader(module)
    if resolved is None:
        raise HTTPException(status_code=403, detail="Kein Lesegerät aktiviert (Verwaltung → Module)")
    _, host, port = resolved

    async def lookup(long_tag: str) -> dict:
        candidate, core = reader_tag_candidates(long_tag)
        return {"tag": long_tag, "ear_tag": candidate, "core": core}

    return scan_response(host, port, lookup)
