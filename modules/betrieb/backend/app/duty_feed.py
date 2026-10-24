"""Dienstplan als Kalender-Abo (ICS) für den Handykalender.

Jede Person bekommt einen geheimen Link (duty_feed_tokens, schema/server/
0005, nicht synchronisiert); ein Link ohne Person zeigt alle Dienste. Der
Kalender ruft ihn ohne Anmeldung ab — darum ist der Link selbst das
Geheimnis und kann jederzeit gesperrt werden. Inhalt: eingeteilte Dienste
von 30 Tagen zurück bis 180 Tage voraus, Ortszeit Europe/Zurich.
"""

import json
import secrets
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool

pool = get_pool("betrieb")

# mit Anmeldung (Links verwalten) und ohne (Kalender ruft ab)
router = APIRouter()
public_router = APIRouter()

AREA = "betrieb:dienste"


def _need(user: CurrentUser, access: str) -> None:
    if f"{AREA}:{access}" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für den Dienstplan")


class TokenRequest(BaseModel):
    person_id: UUID | None = None


class RevokeRequest(BaseModel):
    token: str


@router.post("/duty/feed-token")
async def create_token(body: TokenRequest, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    _need(user, "write")
    token = secrets.token_urlsafe(24)
    async with pool.connection() as conn:
        await conn.execute(
            "insert into duty_feed_tokens (token, person_id, created_by) values (%s, %s, %s)",
            (token, body.person_id, user.email),
        )
        await conn.commit()
    return {"token": token, "path": f"/betrieb/duty/feed/{token}.ics"}


@router.get("/duty/feed-tokens")
async def list_tokens(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    _need(user, "write")
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                "select token, person_id, created_by, created_at from duty_feed_tokens where revoked_at is null order by created_at"
            )
        ).fetchall()
    return [
        {"token": r[0], "person_id": str(r[1]) if r[1] else None, "created_by": r[2], "created_at": r[3].isoformat(), "path": f"/betrieb/duty/feed/{r[0]}.ics"}
        for r in rows
    ]


@router.post("/duty/feed-token/revoke")
async def revoke_token(body: RevokeRequest, user: CurrentUser = Depends(require_auth)) -> dict[str, bool]:
    _need(user, "write")
    async with pool.connection() as conn:
        await conn.execute("update duty_feed_tokens set revoked_at = now() where token = %s", (body.token,))
        await conn.commit()
    return {"ok": True}


_VTIMEZONE = """BEGIN:VTIMEZONE
TZID:Europe/Zurich
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE"""


def _in_range(d: date, frm: str | None, to: str | None) -> bool:
    """MM-DD von..bis inklusive; «von» nach «bis» heisst über den Jahreswechsel."""
    if not frm or not to:
        return True
    md = d.strftime("%m-%d")
    return frm <= md <= to if frm <= to else md >= frm or md <= to


def effective_time(start_time: str, duration_min: int, times: str | None, summer_from: str | None, summer_to: str | None, d: date) -> tuple[str, int]:
    """Beginn und Dauer an diesem Datum: Jahreszeit und Wochentag aus `times`
    (JSON, siehe frontend lib/duty.ts parseTimes), sonst die Standardzeit."""
    if times:
        try:
            season = "sommer" if _in_range(d, summer_from or "04-01", summer_to or "10-31") else "winter"
            entry = json.loads(times).get(season, [])[d.weekday()]
            if isinstance(entry, list) and len(entry) >= 2 and float(entry[1]) > 0 and 0 <= float(entry[0]) < 1440:
                start = int(round(float(entry[0]) / 15) * 15)
                return f"{start // 60 % 24:02d}:{start % 60:02d}", int(round(float(entry[1]) / 15) * 15) or 15
        except (ValueError, TypeError, IndexError, AttributeError):
            pass
    return start_time, duration_min


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\\n").replace("\n", "\\n")


def _fold(line: str) -> str:
    """Zeilen über 75 Bytes umbrechen (RFC 5545)."""
    out, cur = [], ""
    for ch in line:
        if len((cur + ch).encode("utf-8")) > 75:
            out.append(cur)
            cur = " " + ch
        else:
            cur += ch
    out.append(cur)
    return "\r\n".join(out)


def build_ics(name: str, shifts: list[dict[str, Any]], stamp: datetime) -> str:
    """Kalenderdatei aus Diensten (date, start_time 'HH:MM', duration_min,
    type_name, description, notes, person_name, id)."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Riedackerhof//FMIS Dienstplan//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_esc(name)}",
        "X-WR-TIMEZONE:Europe/Zurich",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
        *_VTIMEZONE.split("\n"),
    ]
    dtstamp = stamp.strftime("%Y%m%dT%H%M%SZ")
    for s in shifts:
        h, m = (int(x) for x in str(s["start_time"]).split(":")[:2])
        start = datetime.combine(s["date"], datetime.min.time()).replace(hour=h, minute=m)
        end = start + timedelta(minutes=max(1, int(s["duration_min"] or 60)))
        summary = s["type_name"] + (f" – {s['person_name']}" if s.get("with_person") and s.get("person_name") else "")
        desc = "\n".join(x for x in (s.get("description"), s.get("notes")) if x)
        lines += [
            "BEGIN:VEVENT",
            f"UID:{s['id']}@fmis.riedackerhof.ch",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART;TZID=Europe/Zurich:{start.strftime('%Y%m%dT%H%M%S')}",
            f"DTEND;TZID=Europe/Zurich:{end.strftime('%Y%m%dT%H%M%S')}",
            f"SUMMARY:{_esc(summary)}",
        ]
        if desc:
            lines.append(f"DESCRIPTION:{_esc(desc)}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


@public_router.get("/duty/feed/{token}.ics")
async def feed(token: str) -> Response:
    async with pool.connection() as conn:
        row = await (await conn.execute("select person_id from duty_feed_tokens where token = %s and revoked_at is null", (token,))).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Unbekannter oder gesperrter Link")
        person_id = row[0]
        person_name = None
        if person_id:
            p = await (await conn.execute("select name from duty_people where id = %s", (person_id,))).fetchone()
            person_name = p[0] if p else None
        today = date.today()
        rows = await (
            await conn.execute(
                """select s.id, s.date, t.start_time, t.duration_min, t.name, t.description, s.notes, p.name,
                          t.animal, t.times, t.summer_from, t.summer_to, t.active_from, t.active_to, t.active
                   from duty_shifts s
                   join duty_types t on t.id = s.type_id
                   left join duty_people p on p.id = s.person_id
                   where s.deleted_at is null and s.person_id is not null
                     and s.date between %s and %s
                     and (%s::uuid is null or s.person_id = %s::uuid)
                   order by s.date, t.start_time""",
                (today - timedelta(days=30), today + timedelta(days=180), person_id, person_id),
            )
        ).fetchall()
    shifts = []
    for r in rows:
        # wie im Plan: ausserhalb des Saisonfensters (oder inaktiv) gibt es den Dienst nicht
        if not r[14] or not _in_range(r[1], r[12], r[13]):
            continue
        start, duration = effective_time(r[2], r[3], r[9], r[10], r[11], r[1])
        shifts.append(
            {
                "id": str(r[0]), "date": r[1], "start_time": start, "duration_min": duration,
                "type_name": f"{r[8]} · {r[4]}" if r[8] and str(r[8]).strip() else r[4],
                "description": r[5], "notes": r[6], "person_name": r[7], "with_person": person_id is None,
            }
        )
    name = f"Dienste {person_name}" if person_name else "Dienste Riedackerhof"
    return Response(content=build_ics(name, shifts, datetime.utcnow()), media_type="text/calendar; charset=utf-8")
