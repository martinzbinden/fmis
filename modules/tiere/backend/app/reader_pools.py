"""Gruppen vom Lesegerät holen und zum Import vorschlagen.

Das Lesegerät (APR600) merkt sich gescannte Gruppen im eigenen Speicher («Datenpools»), auch ohne
Empfang. Der Server fragt es nur ab, solange der Schalter «Sync» eingeschaltet ist (`set_sync`,
auf der Seite Tiergruppen): dann im Takt READER_POOL_POLL_S (0 = nie), sonst nie. Das Gerät
nimmt nur eine Verbindung auf einmal an; AgriLink, ADT oder eine Wägung dürfen darum nicht von
einer Hintergrundabfrage gestört werden. Der Schalter ist standardmässig aus und fällt von selbst
zurück, wenn die Seite SYNC_TTL_S Sekunden keinen Herzschlag mehr schickt (Arbeitsunterbruch,
Seite geschlossen, Neustart des Servers). Ist das Gerät erreichbar und nicht anderweitig belegt,
werden Gruppen, die wir noch nicht kennen, samt Ohrmarken in `reader_pools` abgelegt. Die App zeigt sie dann zum
Import an (neue Gruppe oder bestehende ersetzen). Der Server schreibt nur hier und nur ergänzend;
ob etwas importiert wird, entscheidet ein Mensch.

Beim allerersten erfolgreichen Abgleich gilt alles, was schon im Gerät liegt, als «bekannt»
(Altbestand): sonst würden alle früheren Gruppen als neu vorgeschlagen. Sie bleiben in der App
über «Ältere Gruppen auf dem Gerät» erreichbar.

Die Antwortformate von XGGROUPS und XGGROUP sind am echten Gerät bestätigt (siehe
core/backend/fmis_core/agrident.py); die Rohantwort wird je Gruppe trotzdem mitgespeichert."""

import asyncio
import hashlib
import json
import logging
import math
import os
import time
import uuid as uuidlib
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from zoneinfo import ZoneInfo

from core.backend.fmis_core.agrident import ReaderBusyError, ReaderError, acquire_reader, parse_pool_list, parse_pool_tags
from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from core.backend.fmis_core.reader_scan import resolve_reader

log = logging.getLogger(__name__)
pool = get_pool("tiere")
router = APIRouter()

# Die Testumgebung bekommt die Leser-Einstellung von Prod mit: sie darf das echte Gerät nicht im Hintergrund
# abfragen (zwei Verbindungen gleichzeitig können eine laufende Milchwägung auf Prod stören).
INTERVAL_S = 0 if os.environ.get("FMIS_INSTANZ") == "dev" else int(os.environ.get("READER_POOL_POLL_S", "90"))
WRITE = "tiere:herden:write"
RAW_MAX = 2000
_lock = asyncio.Lock()

# Schalter «Sync»: nur im Speicher, nach einem Neustart aus. Die Seite hält ihn mit einem Herzschlag
# (set_sync(True) alle Minute) am Leben; bleibt der aus, fällt er nach SYNC_TTL_S von selbst auf aus.
SYNC_TTL_S = int(os.environ.get("READER_SYNC_TTL_S", "600"))
_sync_until = 0.0
_wake = asyncio.Event()
IDLE_CHECK_S = 60


def sync_seconds_left(now: float | None = None) -> int:
    """Wie lange der Schalter noch an bleibt, wenn kein Herzschlag mehr kommt; 0 = aus."""
    left = _sync_until - (time.time() if now is None else now)
    return math.ceil(left) if left > 0 else 0


def set_sync(on: bool, now: float | None = None) -> int:
    """Schalter setzen oder (bei an) verlängern. Gibt die verbleibenden Sekunden zurück. Wird er neu
    eingeschaltet, fragt `periodic` das Gerät sofort ab."""
    global _sync_until
    t = time.time() if now is None else now
    was_on = sync_seconds_left(t) > 0
    _sync_until = t + SYNC_TTL_S if on else 0.0
    if on and not was_on:
        _wake.set()
    return sync_seconds_left(t)

# Zustand für die Statusanzeige (nur im Speicher; nach einem Neustart leer)
state: dict[str, Any] = {"last_try_at": None, "last_ok_at": None, "last_error": None, "last_new": 0}


def _device_time(local: str | None) -> datetime | None:
    """Zeit des Geräts (Ortszeit, ohne Zeitzone) als Zeitpunkt; None, wenn unbekannt."""
    if not local:
        return None
    return datetime.fromisoformat(local).replace(tzinfo=ZoneInfo("Europe/Zurich"))


def signature(name: str | None, count: int | None, tags: list[str]) -> str:
    """Gleiche Gruppe mit gleichem Inhalt = gleiche Signatur (unabhängig von der Reihenfolge)."""
    digest = hashlib.sha1("\n".join(sorted(tags)).encode()).hexdigest()[:16]
    return f"{name or ''}|{count if count is not None else ''}|{len(tags)}|{digest}"


async def read_device(host: str, port: int, known: set[tuple[str, str]]) -> list[dict[str, Any]]:
    """Gruppen des Geräts. Inhalte (XGGROUP) holt es nur für Gruppen, deren Name+Anzahl wir noch
    nicht in `known` (device_group_id, Kopf) haben — sonst würde jeder Abgleich alles neu laden."""
    out: list[dict[str, Any]] = []
    async with acquire_reader(host, port) as conn:
        raw_list = await conn.send_command("XGGROUPS")
        for g in parse_pool_list(raw_list):
            head = f"{g['name'] or ''}|{g['count'] if g['count'] is not None else ''}"
            if (g["group_id"], head) in known:
                continue
            raw_tags = await conn.send_command("XGGROUP", g["group_id"])
            tags, unmatched, scanned = parse_pool_tags(raw_tags)
            out.append({**g, "head": head, "tags": tags, "unmatched": unmatched, "scanned": scanned, "raw_tags": raw_tags[:RAW_MAX]})
    return out


async def store(found: list[dict[str, Any]], first_run: bool) -> int:
    """Neue Gruppen ablegen; Bekanntes bleibt unverändert. Gibt zurück, wie viele neu vorgeschlagen sind."""
    added = 0
    async with pool.connection() as conn, conn.transaction():
        for g in found:
            sig = signature(g["name"], g["count"], g["tags"])
            status = "bekannt" if first_run else "neu"
            row = await (
                await conn.execute(
                    "insert into reader_pools (id, device_group_id, name, device_count, tag_count, tags, unmatched, raw, signature, status, scanned_at, updated_at) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, clock_timestamp()) "
                    "on conflict (device_group_id, signature) do nothing returning id",
                    (str(uuidlib.uuid4()), g["group_id"], g["name"], g["count"], len(g["tags"]), json.dumps(g["tags"]), json.dumps(g["unmatched"]), g["raw_tags"], sig, status, _device_time(g["scanned"])),
                )
            ).fetchone()
            if not row:
                continue
            if status == "neu":
                added += 1
                # ältere, noch offene Vorschläge derselben Gruppe sind überholt
                await conn.execute(
                    "update reader_pools set status = 'ersetzt', updated_at = clock_timestamp() "
                    "where device_group_id = %s and status = 'neu' and id <> %s",
                    (g["group_id"], row[0]),
                )
    return added


async def refresh() -> dict[str, Any]:
    """Das Gerät jetzt abfragen. Fehler (nicht erreichbar, belegt) sind erwartet und kein Ausnahmefall."""
    async with _lock:
        state["last_try_at"] = time.time()
        resolved = await resolve_reader("tiere")
        if resolved is None:
            state["last_error"] = "Kein Lesegerät aktiviert (Verwaltung → Module)"
            return {"ok": False, "error": state["last_error"], "new": 0}
        _, host, port = resolved
        async with pool.connection() as conn:
            rows = await (await conn.execute("select device_group_id, name, device_count from reader_pools where deleted_at is null")).fetchall()
        known = {(r[0], f"{r[1] or ''}|{r[2] if r[2] is not None else ''}") for r in rows}
        first_run = len(rows) == 0
        try:
            found = await read_device(host, port, known)
        except ReaderBusyError as exc:
            state["last_error"] = str(exc)
            return {"ok": False, "error": str(exc), "new": 0}
        except (ReaderError, OSError) as exc:
            state["last_error"] = str(exc)
            return {"ok": False, "error": str(exc), "new": 0}
        added = await store(found, first_run)
        state.update(last_ok_at=time.time(), last_error=None, last_new=added)
        return {"ok": True, "error": None, "new": added, "seen": len(found), "baseline": first_run}


async def periodic() -> None:
    """Hintergrund (backend/app/main.py): fragt das Gerät nur ab, solange der Schalter «Sync» an ist."""
    if INTERVAL_S <= 0:
        return
    while True:
        wait = IDLE_CHECK_S
        if sync_seconds_left() > 0:
            wait = INTERVAL_S
            try:
                result = await refresh()
                if result.get("new"):
                    log.info("Lesegerät: %s neue Gruppe(n) zum Import vorgeschlagen", result["new"])
            except Exception:
                log.exception("Abgleich mit dem Lesegerät fehlgeschlagen")
        try:
            await asyncio.wait_for(_wake.wait(), timeout=wait)
        except asyncio.TimeoutError:
            pass
        _wake.clear()


def renew_sync(now: float | None = None) -> int:
    """Herzschlag der Seite: verlängert den Schalter nur, wenn er noch an ist. Ein inzwischen abgelaufener
    oder durch Neustart zurückgesetzter Schalter geht so nicht heimlich wieder an."""
    t = time.time() if now is None else now
    return set_sync(True, t) if sync_seconds_left(t) > 0 else 0


@router.get("/reader/status")
async def reader_status(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    left = sync_seconds_left()
    return {
        **state,
        "interval_s": INTERVAL_S,
        "enabled": INTERVAL_S > 0 and await resolve_reader("tiere") is not None,
        "sync_on": left > 0,
        "sync_seconds_left": left,
        "sync_ttl_s": SYNC_TTL_S,
    }


class SyncBody(BaseModel):
    on: bool
    # true = nur verlängern, falls noch an (Herzschlag der Seite)
    renew: bool = False


@router.post("/reader/sync")
async def reader_sync(body: SyncBody, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    """Schalter «Sync» setzen; der Herzschlag der Seite ruft das mit on=true wieder auf und verlängert ihn."""
    if WRITE not in user.permissions:
        raise HTTPException(status_code=403, detail="Das Lesegerät abfragen braucht das Recht Tiergruppen")
    if INTERVAL_S <= 0:
        raise HTTPException(status_code=409, detail="Die Abfrage des Lesegeräts ist auf dieser Instanz abgeschaltet")
    left = renew_sync() if body.renew else set_sync(body.on)
    return {"sync_on": left > 0, "sync_seconds_left": left, "sync_ttl_s": SYNC_TTL_S}


@router.post("/reader/refresh")
async def reader_refresh(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    if WRITE not in user.permissions:
        raise HTTPException(status_code=403, detail="Das Lesegerät abfragen braucht das Recht Tiergruppen")
    return await refresh()


# --- Gruppen am Gerät auswählen und importieren (Seite Tiergruppen → «Gruppen vom Gerät wählen») ---
#
# Unabhängig vom Schalter «Sync»: Ein Mensch fragt ausdrücklich, darum eine kurze Verbindung genau jetzt. Erst die
# Liste (XGGROUPS, schnell), dann nur die gewählten Gruppen mit Inhalt (XGGROUP je Gruppe). Die gewählten landen
# wie die Vorschläge in `reader_pools`, damit «importiert» und der Verlauf dort stehen; anlegen tut die App.

MAX_PICK = 60


async def _reader_or_error() -> tuple[str, int]:
    resolved = await resolve_reader("tiere")
    if resolved is None:
        raise HTTPException(status_code=409, detail="Kein Lesegerät aktiviert (Verwaltung → Module)")
    return resolved[1], resolved[2]


def _device_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ReaderBusyError):
        return HTTPException(status_code=409, detail="Das Lesegerät ist gerade belegt (Milchwägung, AgriLink oder ein anderer Abruf). Bitte kurz warten und nochmals versuchen.")
    return HTTPException(status_code=502, detail=f"Lesegerät nicht erreichbar: {exc}")


async def _imported_heads() -> dict[tuple[str, str], dict[str, Any]]:
    """(Kennung, Kopf) → letzter Import dieser Gruppe in FMIS (Zeitpunkt, Gruppen-ID)."""
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                "select device_group_id, name, device_count, handled_at, imported_group_id from reader_pools "
                "where deleted_at is null and status = 'importiert' order by handled_at"
            )
        ).fetchall()
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        head = f"{r[1] or ''}|{r[2] if r[2] is not None else ''}"
        out[(r[0], head)] = {"imported_at": r[3].isoformat() if r[3] else None, "imported_group_id": str(r[4]) if r[4] else None}
    return out


@router.get("/reader/groups")
async def reader_groups(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    """Gruppen, die jetzt auf dem Gerät liegen (Name, Anzahl Datensätze), mit Hinweis, ob schon importiert."""
    if WRITE not in user.permissions:
        raise HTTPException(status_code=403, detail="Das Lesegerät abfragen braucht das Recht Tiergruppen")
    host, port = await _reader_or_error()
    try:
        async with acquire_reader(host, port) as conn:
            raw = await conn.send_command("XGGROUPS")
    except (ReaderBusyError, ReaderError, OSError) as exc:
        raise _device_error(exc) from exc
    imported = await _imported_heads()
    groups = []
    for g in parse_pool_list(raw):
        head = f"{g['name'] or ''}|{g['count'] if g['count'] is not None else ''}"
        groups.append({"group_id": g["group_id"], "name": g["name"], "count": g["count"], **imported.get((g["group_id"], head), {"imported_at": None, "imported_group_id": None})})
    state.update(last_ok_at=time.time(), last_error=None)
    return {"groups": groups}


class PickBody(BaseModel):
    group_ids: list[str]


async def store_picked(found: list[dict[str, Any]]) -> list[str]:
    """Gewählte Gruppen ablegen (gleicher Inhalt wie schon abgelegt → dieselbe Zeile); gibt die Zeilen-IDs zurück.
    Eine früher verworfene oder überholte Zeile wird wieder «neu», eine importierte bleibt importiert."""
    ids: list[str] = []
    async with pool.connection() as conn, conn.transaction():
        for g in found:
            sig = signature(g["name"], g["count"], g["tags"])
            row = await (
                await conn.execute(
                    "insert into reader_pools (id, device_group_id, name, device_count, tag_count, tags, unmatched, raw, signature, status, scanned_at, updated_at) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'neu', %s, clock_timestamp()) "
                    "on conflict (device_group_id, signature) do update set "
                    "status = case when reader_pools.status in ('verworfen', 'ersetzt') then 'neu' else reader_pools.status end, "
                    "deleted_at = null, updated_at = clock_timestamp() "
                    "returning id",
                    (str(uuidlib.uuid4()), g["group_id"], g["name"], g["count"], len(g["tags"]), json.dumps(g["tags"]), json.dumps(g["unmatched"]), g["raw_tags"], sig, _device_time(g["scanned"])),
                )
            ).fetchone()
            ids.append(str(row[0]))
    return ids


@router.post("/reader/groups/fetch")
async def reader_groups_fetch(body: PickBody, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    """Inhalt der gewählten Gruppen holen (Ohrmarken) und ablegen; die App legt daraus Tiergruppen an."""
    if WRITE not in user.permissions:
        raise HTTPException(status_code=403, detail="Das Lesegerät abfragen braucht das Recht Tiergruppen")
    wanted = list(dict.fromkeys(x.strip() for x in body.group_ids if x.strip()))
    if not wanted:
        raise HTTPException(status_code=400, detail="Keine Gruppe gewählt")
    if len(wanted) > MAX_PICK:
        raise HTTPException(status_code=400, detail=f"Höchstens {MAX_PICK} Gruppen auf einmal")
    host, port = await _reader_or_error()
    found: list[dict[str, Any]] = []
    try:
        async with acquire_reader(host, port) as conn:
            listed = {g["group_id"]: g for g in parse_pool_list(await conn.send_command("XGGROUPS"))}
            for gid in wanted:
                g = listed.get(gid)
                if g is None:
                    continue  # inzwischen am Gerät gelöscht
                raw_tags = await conn.send_command("XGGROUP", gid)
                tags, unmatched, scanned = parse_pool_tags(raw_tags)
                found.append({**g, "tags": tags, "unmatched": unmatched, "scanned": scanned, "raw_tags": raw_tags[:RAW_MAX]})
    except (ReaderBusyError, ReaderError, OSError) as exc:
        raise _device_error(exc) from exc
    ids = await store_picked(found)
    state.update(last_ok_at=time.time(), last_error=None)
    return {
        "groups": [
            {"pool_id": pid, "group_id": g["group_id"], "name": g["name"], "count": g["count"], "tags": g["tags"], "unmatched": g["unmatched"], "scanned_at": g["scanned"]}
            for pid, g in zip(ids, found)
        ],
        "missing": [gid for gid in wanted if gid not in {g["group_id"] for g in found}],
    }
