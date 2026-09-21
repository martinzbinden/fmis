"""APR600-Ohrmarkenleser für die Milchwägung — serverseitige Wägungssitzung.

Der Server hält die Leser-Verbindung (inkl. Keep-alive, siehe
core/backend/fmis_core/agrident.py) UNABHÄNGIG vom Browser: das Handy im
Melkstand darf die Seite verlassen oder den Tab schlafen legen, der Leser
liest weiter. Jede neu gelesene Transpondernummer wird sofort als
`milking_slots`-Zeile in die aktuell offene `milking_banks`-Zeile der
Sitzung geschrieben (Melkstand mit `capacity` Plätzen; ist die Bank voll,
öffnet der Server automatisch die nächste). Der Client bekommt die Zeilen
über den normalen Sync-Pull; `GET /reader/session/events` (SSE) stösst ihn
nach jeder Änderung sofort zum Sync an, damit die Liste ohne 60-s-Intervall
nachzieht.

Der Server schreibt Slots nur beim Lesen (INSERT) und schliesst Bänke
(UPDATE closed_at) — alle späteren Änderungen (gewogen, Notizen,
Umsortieren) macht der Client per Sync, so gibt es keine Konflikte.

Pro Modul-Instanz höchstens eine aktive Sitzung; das physische Gerät ist
ohnehin exklusiv (acquire_reader).
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.backend.fmis_core.agrident import ReaderBusyError, ReaderError, acquire_reader, sheep_short_tag
from core.backend.fmis_core.auth import CurrentUser, require_auth, require_permission
from core.backend.fmis_core.db import get_pool
from core.backend.fmis_core.modules_admin import get_reader_settings, is_reader_enabled, require_reader_enabled


class SessionState(BaseModel):
    active: bool
    session_date: str | None = None
    capacity: int = 12
    current_bank_id: str | None = None
    bank_number: int = 0
    reads: int = 0
    last_read_at: str | None = None
    last_error: str | None = None
    started_by: str | None = None


class _Session:
    def __init__(self, key: str, session_date: date, capacity: int, started_by: str) -> None:
        self.key = key
        self.session_date = session_date
        self.capacity = capacity
        self.started_by = started_by
        self.task: asyncio.Task | None = None
        self.bank_id: uuid.UUID | None = None
        self.bank_number = 0
        self.slots_in_bank = 0
        self.reads = 0
        self.seen: set[str] = set()
        self.last_read_at: datetime | None = None
        self.last_error: str | None = None
        # Version zählt hoch bei jeder DB-Änderung; SSE-Clients warten darauf.
        self.version = 0
        self.changed = asyncio.Event()

    def state(self, active: bool) -> SessionState:
        return SessionState(
            active=active, session_date=self.session_date.isoformat(), capacity=self.capacity,
            current_bank_id=str(self.bank_id) if self.bank_id else None, bank_number=self.bank_number,
            reads=self.reads, last_read_at=self.last_read_at.isoformat() if self.last_read_at else None,
            last_error=self.last_error, started_by=self.started_by,
        )

    def bump(self) -> None:
        self.version += 1
        self.changed.set()
        self.changed = asyncio.Event()


_sessions: dict[str, _Session] = {}


def build_reader_router(key: str) -> APIRouter:
    """Router für EINE Instanz dieses Moduls (analog zu sync.py's build_router)."""
    pool = get_pool(key)
    router = APIRouter()

    @router.get("/reader/status")
    async def status(user: CurrentUser = Depends(require_auth)) -> dict[str, bool]:
        return {"enabled": await is_reader_enabled(key)}

    def _actor(sess: _Session) -> str:
        return f"reader ({sess.started_by})"

    async def _history(conn, table: str, row_id: uuid.UUID, action: str, actor: str) -> None:
        await conn.execute(
            "insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at) "
            f'select gen_random_uuid(), %s, t.id, %s, %s, now(), to_jsonb(t)::text, now() from "{table}" t where t.id = %s',
            (table, action, actor, row_id),
        )

    async def _open_bank(sess: _Session) -> None:
        """Nächste Bank öffnen (und die aktuelle schliessen, falls offen)."""
        now = datetime.now(timezone.utc)
        async with pool.connection() as conn:
            if sess.bank_id is not None:
                await conn.execute(
                    "update milking_banks set closed_at = %s, updated_at = %s where id = %s and closed_at is null",
                    (now, now, sess.bank_id),
                )
                await _history(conn, "milking_banks", sess.bank_id, "update", _actor(sess))
            row = await (await conn.execute(
                "select coalesce(max(bank_number), 0) from milking_banks where session_date = %s and deleted_at is null",
                (sess.session_date,),
            )).fetchone()
            sess.bank_number = int(row[0]) + 1
            sess.bank_id = uuid.uuid4()
            sess.slots_in_bank = 0
            await conn.execute(
                "insert into milking_banks (id, session_date, bank_number, capacity, opened_at, closed_at, notes, updated_at, deleted_at) "
                "values (%s, %s, %s, %s, %s, null, null, %s, null)",
                (sess.bank_id, sess.session_date, sess.bank_number, sess.capacity, now, now),
            )
            await _history(conn, "milking_banks", sess.bank_id, "insert", _actor(sess))
            await conn.commit()
        sess.bump()

    async def _close_bank(sess: _Session) -> None:
        if sess.bank_id is None:
            return
        now = datetime.now(timezone.utc)
        async with pool.connection() as conn:
            await conn.execute(
                "update milking_banks set closed_at = %s, updated_at = %s where id = %s and closed_at is null",
                (now, now, sess.bank_id),
            )
            await _history(conn, "milking_banks", sess.bank_id, "update", _actor(sess))
            await conn.commit()
        sess.bank_id = None
        sess.bump()

    async def _record_read(sess: _Session, long_tag: str) -> None:
        candidate = sheep_short_tag(long_tag) or long_tag
        async with pool.connection() as conn:
            animal = await (await conn.execute(
                "select id, ear_tag from animals where ear_tag in (%s, %s) and deleted_at is null order by ear_tag = %s desc limit 1",
                (candidate, long_tag, candidate),
            )).fetchone()
        if sess.bank_id is None or sess.slots_in_bank >= sess.capacity:
            await _open_bank(sess)
        now = datetime.now(timezone.utc)
        sess.slots_in_bank += 1
        sess.reads += 1
        sess.last_read_at = now
        slot_id = uuid.uuid4()
        async with pool.connection() as conn:
            await conn.execute(
                "insert into milking_slots (id, bank_id, position, original_position, transponder, ear_tag, animal_id, "
                "weighed, notes, read_at, updated_at, deleted_at) values (%s, %s, %s, %s, %s, %s, %s, false, null, %s, %s, null)",
                (slot_id, sess.bank_id, sess.slots_in_bank, sess.slots_in_bank, long_tag,
                 animal[1] if animal else candidate, animal[0] if animal else None, now, now),
            )
            await _history(conn, "milking_slots", slot_id, "insert", _actor(sess))
            await conn.commit()
        sess.bump()

    async def _run(sess: _Session) -> None:
        host, port = await get_reader_settings(key)
        try:
            async with acquire_reader(host, port, keepalive=True) as conn:
                sess.last_error = None
                sess.bump()
                async for long_tag in conn.live_reads():
                    if long_tag in sess.seen:
                        continue
                    sess.seen.add(long_tag)
                    await _record_read(sess, long_tag)
        except asyncio.CancelledError:
            raise
        except (ReaderBusyError, ReaderError, OSError) as exc:
            sess.last_error = str(exc)
            sess.bump()
        except Exception as exc:  # noqa: BLE001 — Sitzung darf nicht stumm sterben
            sess.last_error = f"Unerwarteter Fehler: {exc}"
            sess.bump()

    class StartBody(BaseModel):
        session_date: str | None = None
        capacity: int = 12

    @router.get("/reader/session", response_model=SessionState)
    async def session_state(user: CurrentUser = Depends(require_auth)) -> SessionState:
        sess = _sessions.get(key)
        if sess is None:
            return SessionState(active=False)
        return sess.state(active=bool(sess.task and not sess.task.done()))

    @router.post("/reader/session/start", response_model=SessionState)
    async def session_start(
        body: StartBody,
        user: CurrentUser = Depends(require_permission(f"{key}:milk:write")),
        _reader_ok: CurrentUser = Depends(require_reader_enabled(key)),
    ) -> SessionState:
        sess = _sessions.get(key)
        if sess and sess.task and not sess.task.done():
            return sess.state(active=True)
        session_date = date.fromisoformat(body.session_date) if body.session_date else date.today()
        capacity = max(1, min(body.capacity, 60))
        sess = _Session(key, session_date, capacity, user.email)
        # Bestehende offene Bank des Tages weiterverwenden (z.B. nach Neustart)
        async with pool.connection() as conn:
            row = await (await conn.execute(
                "select b.id, b.bank_number, (select count(*) from milking_slots s where s.bank_id = b.id and s.deleted_at is null) "
                "from milking_banks b where b.session_date = %s and b.deleted_at is null and b.closed_at is null "
                "order by b.bank_number desc limit 1",
                (session_date,),
            )).fetchone()
            if row:
                sess.bank_id, sess.bank_number, sess.slots_in_bank = row[0], int(row[1]), int(row[2])
            # Bereits heute gelesene Transponder nicht nochmals aufnehmen
            rows = await (await conn.execute(
                "select s.transponder from milking_slots s join milking_banks b on b.id = s.bank_id "
                "where b.session_date = %s and s.deleted_at is null and s.transponder is not null",
                (session_date,),
            )).fetchall()
            sess.seen = {r[0] for r in rows}
        sess.task = asyncio.create_task(_run(sess))
        _sessions[key] = sess
        await asyncio.sleep(0.3)  # kurze Chance, einen sofortigen Verbindungsfehler mitzugeben
        return sess.state(active=not sess.task.done())

    @router.post("/reader/session/stop", response_model=SessionState)
    async def session_stop(user: CurrentUser = Depends(require_permission(f"{key}:milk:write"))) -> SessionState:
        sess = _sessions.get(key)
        if sess is None:
            return SessionState(active=False)
        if sess.task and not sess.task.done():
            sess.task.cancel()
            try:
                await sess.task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        await _close_bank(sess)
        state = sess.state(active=False)
        del _sessions[key]
        return state

    @router.post("/reader/session/next-bank", response_model=SessionState)
    async def session_next_bank(user: CurrentUser = Depends(require_permission(f"{key}:milk:write"))) -> SessionState:
        """Aktuelle Bank abschliessen (archivieren) — die nächsten Lesungen
        landen in einer neuen Bank."""
        sess = _sessions.get(key)
        if sess is None or not sess.task or sess.task.done():
            raise HTTPException(status_code=409, detail="Keine aktive Wägungssitzung")
        await _close_bank(sess)
        return sess.state(active=True)

    @router.get("/reader/session/events")
    async def session_events(user: CurrentUser = Depends(require_auth)) -> StreamingResponse:
        """SSE: ein Event pro Änderung (neue Lesung, Bankwechsel, Fehler) —
        der Client löst dann sofort einen Sync-Pull aus. Alle 25 s ein
        Kommentar als Heartbeat, damit Proxies die Verbindung nicht kappen."""

        async def stream():
            last_version = -1
            while True:
                sess = _sessions.get(key)
                if sess is None:
                    yield f"data: {json.dumps(SessionState(active=False).model_dump())}\n\n"
                    await asyncio.sleep(3)
                    continue
                if sess.version != last_version:
                    last_version = sess.version
                    yield f"data: {json.dumps(sess.state(active=bool(sess.task and not sess.task.done())).model_dump())}\n\n"
                try:
                    await asyncio.wait_for(sess.changed.wait(), timeout=25)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    return router
