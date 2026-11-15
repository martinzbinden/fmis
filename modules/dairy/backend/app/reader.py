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
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.backend.fmis_core.agrident import ReaderBusyError, ReaderError, acquire_reader, parse_pool_list, parse_pool_records, reader_tag_candidates
from core.backend.fmis_core.auth import CurrentUser, require_auth, require_permission
from core.backend.fmis_core.db import get_pool
from core.backend.fmis_core.modules_admin import get_reader_settings, is_reader_enabled, require_reader_enabled
from core.backend.fmis_core.reader_scan import scan_response


DUPLICATE_WINDOW_S = 60.0
# «Letzte Lesungen holen»: höchstens so viele Lesungen der letzten Gruppe des Geräts.
FETCH_RECENT_MAX = 12
# Schon da: dasselbe Tier wurde in den letzten Stunden (Serverzeit) schon in eine Bank aufgenommen. Die Uhr des Geräts
# taugt dafür nicht (sie geht oft falsch); Morgen- und Abendmelken liegen weiter auseinander.
FETCH_SAME_READ_HOURS = 3


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
    handshake: str | None = None
    last_ignored: str | None = None
    # Verbindungsdetails (siehe agrident.ReaderConnection)
    host: str | None = None
    port: int | None = None
    connected_since: str | None = None
    pings: int = 0
    pongs: int = 0
    last_pong_at: str | None = None
    rtt_ms: float | None = None
    noise_bytes: int = 0
    frames: int = 0


# Modul-Ebene (nicht in build_reader_router): mit `from __future__ import
# annotations` löst FastAPI die Annotation über die Modul-Globals auf — eine
# lokal definierte Klasse würde als Query-Parameter fehlinterpretiert.
class StartBody(BaseModel):
    session_date: str | None = None
    capacity: int = 12


class FetchBody(BaseModel):
    session_date: str | None = None
    capacity: int = 12


class FetchResult(BaseModel):
    added: int
    already_there: int
    group: str | None = None
    found: int = 0
    # neue Lesungen, die keinen Platz mehr hatten (Bank voll): sie kommen in die nächste Bank, sobald sie offen ist
    waiting: int = 0


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
        # Duplikate: derselbe Transponder in der aktuell offenen Bank oder
        # innerhalb von DUPLICATE_WINDOW_S wird nicht nochmals aufgenommen
        # (Tier steht noch an der Antenne). Über Bänke hinweg — z.B. Morgen-
        # und Abendmelken am selben Tag — sind Wiederholungen erwünscht.
        self.bank_tags: set[str] = set()
        self.recent: dict[str, float] = {}
        self.last_ignored: str | None = None
        self.last_read_at: datetime | None = None
        self.last_error: str | None = None
        # Handshake-Ergebnis: Antwort des Lesers auf [XGMEMINFO] (z.B. "448|1000000|…")
        self.handshake: str | None = None
        self.host: str | None = None
        self.port: int | None = None
        self.conn = None  # ReaderConnection, solange verbunden
        # Version zählt hoch bei jeder DB-Änderung; SSE-Clients warten darauf.
        self.version = 0
        self.changed = asyncio.Event()
        # Zuletzt geschriebene Zeilen (Bank/Slot) — gehen mit dem SSE-Event
        # direkt an den Client, der sie sofort lokal einträgt statt auf den
        # nächsten Pull zu warten. Ringpuffer der letzten 50 Ereignisse.
        self.events: list[dict] = []

    def push_event(self, kind: str, row: dict) -> None:
        self.events.append({"seq": self.version + 1, "kind": kind, "row": row})
        del self.events[:-50]

    def state(self, active: bool) -> SessionState:
        return SessionState(
            active=active, session_date=self.session_date.isoformat(), capacity=self.capacity,
            current_bank_id=str(self.bank_id) if self.bank_id else None, bank_number=self.bank_number,
            reads=self.reads, last_read_at=self.last_read_at.isoformat() if self.last_read_at else None,
            last_error=self.last_error, started_by=self.started_by, handshake=self.handshake,
            last_ignored=self.last_ignored, host=self.host, port=self.port,
            connected_since=datetime.fromtimestamp(self.conn.connected_at, timezone.utc).isoformat() if self.conn else None,
            pings=self.conn.pings if self.conn else 0,
            pongs=self.conn.pongs if self.conn else 0,
            last_pong_at=datetime.fromtimestamp(self.conn.last_pong_at, timezone.utc).isoformat() if self.conn and self.conn.last_pong_at else None,
            rtt_ms=self.conn.last_rtt_ms if self.conn else None,
            noise_bytes=self.conn.noise_bytes if self.conn else 0,
            frames=self.conn.frames if self.conn else 0,
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
            sess.bank_tags = set()
            await conn.execute(
                "insert into milking_banks (id, session_date, bank_number, capacity, opened_at, closed_at, notes, updated_at, deleted_at) "
                "values (%s, %s, %s, %s, %s, null, null, %s, null)",
                (sess.bank_id, sess.session_date, sess.bank_number, sess.capacity, now, now),
            )
            await _history(conn, "milking_banks", sess.bank_id, "insert", _actor(sess))
            await conn.commit()
        sess.push_event("milking_banks", {
            "id": str(sess.bank_id), "session_date": sess.session_date.isoformat(), "bank_number": sess.bank_number,
            "capacity": sess.capacity, "opened_at": now.isoformat(), "closed_at": None, "notes": None,
            "updated_at": now.isoformat(), "deleted_at": None,
        })
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
            row = await (await conn.execute(
                "select id, session_date, bank_number, capacity, opened_at, closed_at, notes, updated_at, deleted_at "
                "from milking_banks where id = %s", (sess.bank_id,))).fetchone()
            await conn.commit()
        if row:
            sess.push_event("milking_banks", {
                "id": str(row[0]), "session_date": row[1].isoformat(), "bank_number": row[2], "capacity": row[3],
                "opened_at": row[4].isoformat(), "closed_at": row[5].isoformat() if row[5] else None, "notes": row[6],
                "updated_at": row[7].isoformat(), "deleted_at": row[8].isoformat() if row[8] else None,
            })
        sess.bank_id = None
        sess.bump()

    async def _record_read(sess: _Session, long_tag: str) -> None:
        # Zuordnung: Kurzform (CH + 8 Ziffern) oder Langform (CH113 + 8 Ziffern + Prüfziffer)
        candidate, core = reader_tag_candidates(long_tag)
        async with pool.connection() as conn:
            animal = await (await conn.execute(
                "select id, ear_tag from animals where deleted_at is null and "
                "(ear_tag in (%s, %s) or (%s::text is not null and ear_tag ~ ('^CH113' || %s::text || '[0-9]$'))) "
                "order by status = 'aktiv' desc limit 1",
                (candidate, long_tag, core, core),
            )).fetchone()
        if sess.bank_id is None or sess.slots_in_bank >= sess.capacity:
            await _open_bank(sess)
        # Immer die Serverzeit: die Uhr des Lesegeräts geht oft falsch (am 15.11.2026 rund 1 h vor). Mit ihr als
        # updated_at galten geholte Zeilen als «neuer» als jede Eingabe, und der Abgleich verwarf die Milchmengen.
        now = datetime.now(timezone.utc)
        sess.bank_tags.add(long_tag)
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
        sess.push_event("milking_slots", {
            "id": str(slot_id), "bank_id": str(sess.bank_id), "position": sess.slots_in_bank,
            "original_position": sess.slots_in_bank, "transponder": long_tag,
            "ear_tag": animal[1] if animal else candidate, "animal_id": str(animal[0]) if animal else None,
            "weighed": False, "notes": None, "read_at": now.isoformat(), "updated_at": now.isoformat(), "deleted_at": None,
        })
        sess.bump()

    async def _run(sess: _Session) -> None:
        host, port = await get_reader_settings(key)
        sess.host, sess.port = host, port
        try:
            async with acquire_reader(host, port, keepalive=True) as conn:
                sess.conn = conn
                # Handshake: erst wenn der Leser auf einen Befehl antwortet,
                # ist er wirklich "im Protokoll" (ein angenommener TCP-Socket
                # allein sagt nichts — WLAN-Modul vs. Lesegerät).
                try:
                    sess.handshake = await conn.send_command("XGMEMINFO", timeout=5.0)
                except ReaderError as exc:
                    sess.last_error = f"TCP verbunden, aber der Leser antwortet nicht auf Befehle ({exc}) — AgriLink-/WLAN-Modus am Gerät prüfen"
                    sess.bump()
                    return
                sess.last_error = None
                sess.bump()
                async for long_tag in conn.live_reads():
                    t = time.monotonic()
                    last = sess.recent.get(long_tag)
                    sess.recent[long_tag] = t
                    if long_tag in sess.bank_tags or (last is not None and t - last < DUPLICATE_WINDOW_S):
                        sess.last_ignored = f"{reader_tag_candidates(long_tag)[0]} ({'schon in dieser Bank' if long_tag in sess.bank_tags else 'Wiederholung'})"
                        sess.bump()
                        continue
                    await _record_read(sess, long_tag)
        except asyncio.CancelledError:
            raise
        except (ReaderBusyError, ReaderError, OSError) as exc:
            sess.last_error = str(exc)
            sess.bump()
        except Exception as exc:  # noqa: BLE001 — Sitzung darf nicht stumm sterben
            sess.last_error = f"Unerwarteter Fehler: {exc}"
            sess.bump()
        finally:
            sess.conn = None

    async def _prepare(session_date_text: str | None, capacity_in: int, started_by: str) -> _Session:
        """Sitzung für den Tag anlegen und die offene Bank des Tages weiterverwenden (z.B. nach Neustart)."""
        session_date = date.fromisoformat(session_date_text) if session_date_text else date.today()
        capacity = max(1, min(capacity_in, 60))
        sess = _Session(key, session_date, capacity, started_by)
        async with pool.connection() as conn:
            row = await (await conn.execute(
                "select b.id, b.bank_number, (select count(*) from milking_slots s where s.bank_id = b.id and s.deleted_at is null) "
                "from milking_banks b where b.session_date = %s and b.deleted_at is null and b.closed_at is null "
                "order by b.bank_number desc limit 1",
                (session_date,),
            )).fetchone()
            if row:
                sess.bank_id, sess.bank_number, sess.slots_in_bank = row[0], int(row[1]), int(row[2])
                # Transponder der weitergeführten offenen Bank (Duplikatschutz)
                rows = await (await conn.execute(
                    "select transponder from milking_slots where bank_id = %s and deleted_at is null and transponder is not null",
                    (sess.bank_id,),
                )).fetchall()
                sess.bank_tags = {r[0] for r in rows}
        return sess

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
        sess = await _prepare(body.session_date, body.capacity, user.email)
        sess.task = asyncio.create_task(_run(sess))
        _sessions[key] = sess
        await asyncio.sleep(0.3)  # kurze Chance, einen sofortigen Verbindungsfehler mitzugeben
        return sess.state(active=not sess.task.done())

    @router.post("/reader/session/fetch-recent", response_model=FetchResult)
    async def fetch_recent(
        body: FetchBody,
        user: CurrentUser = Depends(require_permission(f"{key}:milk:write")),
        _reader_ok: CurrentUser = Depends(require_reader_enabled(key)),
    ) -> FetchResult:
        """Die letzten (höchstens 12) Lesungen der letzten Gruppe im Gerätespeicher holen, die in den Bänken des Tages noch
        fehlen, und in der Reihenfolge des Geräts aufnehmen — als Ergänzung zur Live-Lesung (z.B. nach einem Funkloch).
        Das Gerät lässt nur eine Verbindung zu: eine laufende Sitzung wird dafür kurz unterbrochen und danach weitergeführt."""
        sess = _sessions.get(key)
        was_active = bool(sess and sess.task and not sess.task.done())
        if was_active and sess:
            sess.task.cancel()  # type: ignore[union-attr]
            try:
                await sess.task  # type: ignore[misc]
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        else:
            sess = await _prepare(body.session_date, body.capacity, user.email)
            _sessions[key] = sess
        host, port = await get_reader_settings(key)
        sess.host, sess.port = host, port
        try:
            async with acquire_reader(host, port) as conn:
                groups = [g for g in parse_pool_list(await conn.send_command("XGGROUPS")) if g["count"]]
                if not groups:
                    return FetchResult(added=0, already_there=0)
                last = groups[-1]
                raw = await conn.send_command("XGGROUP", last["group_id"], timeout=30.0)
        except ReaderBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (ReaderError, OSError) as exc:
            raise HTTPException(status_code=502, detail=f"Leser nicht erreichbar oder antwortet nicht ({exc})") from exc
        finally:
            if was_active and sess and not (sess.task and not sess.task.done()):
                sess.task = asyncio.create_task(_run(sess))

        records = parse_pool_records(raw)[-FETCH_RECENT_MAX:]
        since = datetime.now(timezone.utc) - timedelta(hours=FETCH_SAME_READ_HOURS)
        async with pool.connection() as conn:
            rows = await (await conn.execute(
                "select distinct s.transponder from milking_slots s join milking_banks b on b.id = s.bank_id "
                "where b.deleted_at is null and s.deleted_at is null and s.transponder is not null and s.read_at >= %s",
                (since,),
            )).fetchall()
            # Plätze der offenen Bank aus der Datenbank (auch manuell aufgenommene zählen)
            if sess.bank_id is not None:
                row = await (await conn.execute(
                    "select b.closed_at is null, (select count(*) from milking_slots s where s.bank_id = b.id and s.deleted_at is null) "
                    "from milking_banks b where b.id = %s", (sess.bank_id,))).fetchone()
                if row and row[0]:
                    sess.slots_in_bank = int(row[1])
                else:
                    sess.bank_id, sess.slots_in_bank = None, 0
        seen = {r[0] for r in rows}
        # nur so viele, wie Plätze frei sind: die nächste Bank öffnet die Seite (Knopf «+»), nicht der Abruf
        free = sess.capacity - sess.slots_in_bank if sess.bank_id is not None else sess.capacity
        added = already = waiting = 0
        for tag, _device_time in records:
            if tag in seen:
                already += 1
                continue
            if added >= free:
                waiting += 1
                continue
            await _record_read(sess, tag)
            seen.add(tag)
            added += 1
        return FetchResult(added=added, already_there=already, group=last["name"], found=len(records), waiting=waiting)

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
        """Aktuelle Bank abschliessen und gleich eine neue, leere Bank öffnen: die Seite zeigt sie sofort (mit dem Knopf
        «Neu gelesene Ohrmarken holen»), die nächsten Lesungen landen dort."""
        sess = _sessions.get(key)
        if sess is None or not sess.task or sess.task.done():
            raise HTTPException(status_code=409, detail="Keine aktive Wägungssitzung")
        await _open_bank(sess)
        return sess.state(active=True)

    @router.get("/reader/scan")
    async def scan(
        user: CurrentUser = Depends(require_permission(f"{key}:animals:write")),
        _reader_ok: CurrentUser = Depends(require_reader_enabled(key)),
    ) -> StreamingResponse:
        """SSE: gelesene Ohrmarken, solange der Browser zuhört — für Erfassungen wie die
        Trächtigkeit (keine Wägungssitzung, nichts wird geschrieben). Schliesst der Browser
        die Verbindung, gibt der Server das Lesegerät wieder frei. Nicht während einer
        Milchwägung (das Gerät ist exklusiv)."""
        sess = _sessions.get(key)
        if sess and sess.task and not sess.task.done():
            raise HTTPException(status_code=409, detail="Das Lesegerät ist in der Milchwägung belegt")
        host, port = await get_reader_settings(key)

        async def lookup(long_tag: str) -> dict:
            candidate, core = reader_tag_candidates(long_tag)
            async with pool.connection() as conn:
                animal = await (await conn.execute(
                    "select id, ear_tag from animals where deleted_at is null and "
                    "(ear_tag in (%s, %s) or (%s::text is not null and ear_tag ~ ('^CH113' || %s::text || '[0-9]$'))) "
                    "order by status = 'aktiv' desc limit 1",
                    (candidate, long_tag, core, core),
                )).fetchone()
            return {"tag": long_tag, "ear_tag": animal[1] if animal else candidate, "animal_id": str(animal[0]) if animal else None}

        return scan_response(host, port, lookup)

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
                    pending = [e for e in sess.events if e["seq"] > last_version]
                    last_version = sess.version
                    payload = sess.state(active=bool(sess.task and not sess.task.done())).model_dump()
                    payload["events"] = pending
                    yield f"data: {json.dumps(payload)}\n\n"
                try:
                    await asyncio.wait_for(sess.changed.wait(), timeout=25)
                except asyncio.TimeoutError:
                    # Kein Datenereignis — trotzdem den Zustand schicken, damit
                    # Verbindungsqualität (Pong-Alter, RTT) im Client aktuell bleibt.
                    last_version = -1

        return StreamingResponse(stream(), media_type="text/event-stream")

    return router
