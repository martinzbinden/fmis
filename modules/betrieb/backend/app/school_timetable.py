"""Schultage aus dem öffentlichen Stundenplan (WebUntis) als Abwesenheit «schule».

Bei der Person steht die Klasse (duty_people.school_class, z.B. NHB2026/29-Ru) und,
falls bekannt, die Halbklasse. Jede Nacht und auf Knopfdruck liest der Server die
Wochen ab heute und gleicht ab:

- neuer Schul- oder Kurstag → eine Abwesenheit je Tag (import_key webuntis:<Person>:<Datum>);
  vom Büro gelöschte Tage kommen nicht wieder,
- Tag nicht mehr im Stundenplan → nie löschen, nur missing_since setzen; das Büro
  entscheidet (Importe löschen nie),
- Kurs nur für eine Halbklasse und Halbklasse unbekannt → nur Hinweis ans Büro,
- ist die Person an einem neuen Schultag schon eingeteilt → Konflikt ans Büro.

Alles, was sich ändert, geht als eine Meldung je Person ans Büro (Glocke, E-Mail).
Ganze Tage: wer Schule hat, macht an dem Tag keinen Dienst (langer Schulweg).
"""

import asyncio
import http.cookiejar
import json
import logging
import os
import re
import urllib.parse
import urllib.request
import uuid as uuidlib
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from core.backend.fmis_core.notifications import notify, office_emails
from .duty_requests import DIENSTE_WRITE, _dm, _history

log = logging.getLogger(__name__)
pool = get_pool("betrieb")
router = APIRouter()

BASE = os.environ.get("WEBUNTIS_URL", "https://inforama.webuntis.com/WebUntis").rstrip("/")
SCHOOL = os.environ.get("WEBUNTIS_SCHOOL", "inforama")
SOURCE = "webuntis"
WEEKS_AHEAD = 52
# Stunden, die nicht stattfinden
SKIP_STATES = {"CANCEL", "FREE"}
LINK = "/betrieb/dienste?tab=abwesend"
RUN_HOUR_UTC = 2  # nachts, vor dem Melken
_HALF = re.compile(r"Halbklasse\s+([AB])\b")
_lock = asyncio.Lock()


# --- Stundenplan lesen (ohne Anmeldung, wie die öffentliche Seite) -----------------

def _hm(t: int) -> str:
    return f"{t // 100:02d}:{t % 100:02d}"


def _fetch(klass: str, start: date, weeks: int) -> tuple[list[dict[str, Any]], date]:
    """Alle Stunden der Klasse ([{date, start, end, subjects}]) und bis wann gelesen (exklusiv).
    Nach dem Ende des veröffentlichten Schuljahres gibt WebUntis einen Fehler statt leerer Wochen:
    dort hört das Lesen auf. Blockierend (in einem Thread aufrufen)."""
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("Accept", "application/json"), ("User-Agent", "FMIS Riedackerhof (Dienstplan)")]
    opener.open(f"{BASE}/?school={urllib.parse.quote(SCHOOL)}", timeout=30).read()

    def get(path: str) -> Any:
        with opener.open(f"{BASE}/api/public/timetable/weekly/{path}", timeout=30) as r:
            return json.load(r)

    conf = get(f"pageconfig?type=1&date={start.isoformat()}")
    elements = conf["data"]["elements"]
    match = next((e for e in elements if (e.get("name") or "").strip().lower() == klass.strip().lower()), None)
    if match is None:
        raise ValueError(f"Klasse «{klass}» im Stundenplan nicht gefunden")
    cid = match["id"]

    out: list[dict[str, Any]] = []
    monday = start - timedelta(days=start.weekday())
    for w in range(weeks):
        day = monday + timedelta(weeks=w)
        res = get(f"data?elementType=1&elementId={cid}&date={day.isoformat()}&formatId=1")["data"]
        if "result" not in res:  # ERR_TTVIEW_NOTALLOWED_ONDATE: Schuljahr noch nicht veröffentlicht
            return out, day
        data = res["result"]["data"]
        names = {(e["type"], e["id"]): e.get("longName") or e.get("name") or "" for e in data.get("elements", [])}
        for p in data.get("elementPeriods", {}).get(str(cid), []):
            if p.get("cellState") in SKIP_STATES:
                continue
            d = str(p["date"])
            out.append({
                "date": f"{d[:4]}-{d[4:6]}-{d[6:]}",
                "start": p["startTime"],
                "end": p["endTime"],
                "subjects": [names.get((e["type"], e["id"]), "") for e in p.get("elements", []) if e["type"] == 3],
            })
    return out, monday + timedelta(weeks=weeks)


def school_days(periods: list[dict[str, Any]], half: str | None) -> tuple[dict[str, str], dict[str, str]]:
    """(Tage mit Schule → Bemerkung, Tage nur mit Halbklassen-Kurs bei unbekannter Halbklasse → Kursname).

    Ein Tag zählt, sobald eine Stunde die ganze Klasse oder die eigene Halbklasse betrifft."""
    by_day: dict[str, list[dict[str, Any]]] = {}
    for p in periods:
        by_day.setdefault(p["date"], []).append(p)
    days: dict[str, str] = {}
    hints: dict[str, str] = {}
    for day, ps in sorted(by_day.items()):
        mine: list[dict[str, Any]] = []
        open_half: list[str] = []
        for p in ps:
            halves = {m.group(1) for s in p["subjects"] for m in [_HALF.search(s)] if m}
            if not halves or (half and half in halves):
                mine.append(p)
            elif not half:
                open_half += [s for s in p["subjects"] if _HALF.search(s)]
        if mine:
            courses = sorted({_short(s) for p in mine for s in p["subjects"] if s.startswith("ÜK")})
            von, bis = min(p["start"] for p in mine), max(p["end"] for p in mine)
            days[day] = f"{' / '.join(courses) if courses else 'Schule'} {_hm(von)}–{_hm(bis)}"
        elif open_half:
            hints[day] = " / ".join(sorted({_short(s) for s in open_half}))
    return days, hints


def _short(subject: str) -> str:
    """«ÜK3 Halbklasse A (ohne Gewähr, …)» → «ÜK3 Halbklasse A»."""
    return subject.split("(")[0].strip()


# --- Abgleich -----------------------------------------------------------------------

async def sync_person(conn: Any, person: dict[str, Any], today: date, by: str) -> dict[str, Any]:
    """Abgleich für eine Person (laufende Transaktion). Gibt eine Zusammenfassung zurück."""
    pid, name, klass, half = person["id"], person["name"], person["school_class"], person["school_half"]
    periods, until = await asyncio.to_thread(_fetch, klass, today, WEEKS_AHEAD)
    days, hints = school_days(periods, half)
    days = {d: n for d, n in days.items() if d >= today.isoformat()}
    hints = {d: n for d, n in hints.items() if d >= today.isoformat()}

    rows = await (
        await conn.execute(
            "select id, from_date, deleted_at, missing_since from duty_absences where person_id = %s and source = %s",
            (pid, SOURCE),
        )
    ).fetchall()
    known = {r[1].isoformat(): r for r in rows}
    if not days and any(r[2] is None and today <= r[1] < until for r in rows):
        # leerer Stundenplan (Schuljahr noch nicht erfasst, Störung): nichts als fehlend markieren
        raise RuntimeError("Stundenplan ohne Schultage, Abgleich abgebrochen")

    added: list[str] = []
    for day, note in days.items():
        if day in known:
            continue
        aid = str(uuidlib.uuid4())
        await conn.execute(
            "insert into duty_absences (id, person_id, from_date, to_date, kind, notes, created_by, source, import_key, updated_at) "
            "values (%s, %s, %s, %s, 'schule', %s, %s, %s, %s, clock_timestamp())",
            (aid, pid, day, day, f"{note} (Stundenplan {klass})", by, SOURCE, f"{SOURCE}:{pid}:{day}"),
        )
        await _history(conn, "duty_absences", aid, by)
        added.append(day)

    back: list[str] = []
    missing: list[str] = []
    last = until.isoformat()  # nur gelesene Wochen vergleichen
    for day, (aid, _, deleted_at, missing_since) in sorted(known.items()):
        if deleted_at is not None:
            continue
        if day in days and missing_since is not None:
            back.append(day)
        elif day not in days and missing_since is None and today.isoformat() <= day < last:
            missing.append(day)
        else:
            continue
        await conn.execute(
            "update duty_absences set missing_since = %s, updated_at = clock_timestamp() where id = %s",
            (None if day in days else today, aid),
        )
        await _history(conn, "duty_absences", aid, by)

    new_hints: list[str] = []
    for day, course in hints.items():
        key = f"halbklasse:{pid}:{day}"
        if (await (await conn.execute("insert into school_notices (key) values (%s) on conflict do nothing returning key", (key,))).fetchone()):
            new_hints.append(f"{_dm(day)} {course}")

    conflicts: list[str] = []
    if added:
        for d, tname, animal, status in await (
            await conn.execute(
                "select s.date, t.name, t.animal, w.status from duty_shifts s join duty_types t on t.id = s.type_id "
                "left join duty_weeks w on w.week_start = s.date - (extract(isodow from s.date)::int - 1) and w.deleted_at is null "
                "where s.person_id = %s and s.deleted_at is null and s.date = any(%s::date[]) order by s.date",
                (pid, added),
            )
        ).fetchall():
            label = f"{animal} · {tname}" if animal else tname
            conflicts.append(f"{_dm(d)} {label}" + (" (bestätigte Woche)" if status == "bestaetigt" else ""))

    parts: list[str] = []
    if added:
        parts.append(f"{len(added)} {'Tag' if len(added) == 1 else 'Tage'} neu eingetragen: {_days(added)}")
    if missing:
        parts.append(f"nicht mehr im Stundenplan (bitte prüfen, ggf. löschen): {_days(missing)}")
    if back:
        parts.append(f"wieder im Stundenplan: {_days(back)}")
    if new_hints:
        parts.append(f"Halbklasse unbekannt, nicht eingetragen: {', '.join(new_hints)}. Halbklasse bei der Person festlegen (Einstellungen)")
    if conflicts:
        parts.append(f"schon für Dienste eingeteilt: {', '.join(conflicts)}")
    if parts:
        title = f"Stundenplan {name}: " + ("Konflikt mit Diensten" if conflicts else "Änderungen")
        await notify(conn, await office_emails(conn, DIENSTE_WRITE), "konflikt" if conflicts else "schule", title, ". ".join(x.rstrip(".") for x in parts) + ".", LINK)
    return {"person": name, "days": len(days), "until": (until - timedelta(days=1)).isoformat(), "added": added, "missing": missing, "back": back, "hints": new_hints, "conflicts": conflicts}


def _days(days: list[str]) -> str:
    return ", ".join(_dm(d) for d in days)


async def sync_all(by: str, person_id: str | None = None) -> list[dict[str, Any]]:
    """Alle Personen mit Klasse (oder nur eine). Fehler einer Person brechen die anderen nicht ab."""
    async with _lock:
        today = datetime.now(timezone.utc).date()
        results: list[dict[str, Any]] = []
        async with pool.connection() as conn:
            sql = "select id, name, school_class, school_half from duty_people where deleted_at is null and active and coalesce(school_class, '') <> ''"
            params: tuple = ()
            if person_id:
                sql += " and id = %s"
                params = (person_id,)
            people = [dict(zip(("id", "name", "school_class", "school_half"), r)) for r in await (await conn.execute(sql, params)).fetchall()]
            await conn.commit()
            for p in people:
                try:
                    results.append(await sync_person(conn, p, today, by))
                    await conn.commit()
                except Exception as e:  # Netz, Klasse nicht gefunden …: nichts ändern, melden
                    await conn.rollback()
                    log.warning("Stundenplan %s (%s): %s", p["name"], p["school_class"], e)
                    results.append({"person": p["name"], "error": str(e)})
        return results


async def nightly() -> None:
    """Hintergrund: jede Nacht abgleichen (gestartet in backend/app/main.py)."""
    while True:
        now = datetime.now(timezone.utc)
        run = now.replace(hour=RUN_HOUR_UTC, minute=0, second=0, microsecond=0)
        if run <= now:
            run += timedelta(days=1)
        await asyncio.sleep((run - now).total_seconds())
        try:
            for r in await sync_all("Stundenplan (WebUntis)"):
                log.info("Stundenplan-Abgleich: %s", r)
        except Exception:
            log.exception("Stundenplan-Abgleich fehlgeschlagen")


class SyncRequest(BaseModel):
    person_id: str | None = None


@router.post("/duty/school-sync")
async def school_sync(body: SyncRequest, user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    if DIENSTE_WRITE not in user.permissions:
        raise HTTPException(status_code=403, detail="Den Stundenplan abrufen kann das Büro")
    return await sync_all(f"{user.email} (Stundenplan)", body.person_id)
