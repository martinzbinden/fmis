"""Dienstplan-Anträge und Abwesenheiten: Prüfung beim Push und Folgen danach.

Wer den Plan nicht führt (kein betrieb:dienste:write):
- stellt Anträge nur für die eigene Person und entscheidet nie selbst,
- stimmt als Gegenpartei eines Abtauschs zu oder lehnt ab (nur dieses Feld),
- trägt direkt nur die eigene Krankmeldung ein.

Nach dem Schreiben: Stimmt die Gegenpartei zu, führt der Server den Tausch aus
(gleiche Transaktion) und informiert Antragsteller und Büro. Lehnt sie ab, sieht
das Büro den Konflikt und entscheidet. Alle Schritte erzeugen Benachrichtigungen
(Glocke, E-Mail je Profil).
"""

import json
import uuid as uuidlib
from datetime import date, datetime
from typing import Any

from core.backend.fmis_core.auth import CurrentUser
from core.backend.fmis_core.notifications import notify, office_emails

DIENSTE_WRITE = "betrieb:dienste:write"
OFFENE_STATUS = ("offen", "zurueckgezogen")
LINK = "/betrieb/dienste?tab=antraege"
# Felder, die die Gegenpartei NICHT ändern darf (alles ausser ihrer Antwort)
FIXED = (
    "kind", "person_id", "shift_id", "date", "type_id", "to_person", "other_shift_id", "other_date",
    "other_type_id", "from_date", "to_date", "notes", "status", "created_by", "absence_kind",
)
KIND_LABEL = {"ferien": "Ferien", "frei": "frei", "krank": "krank", "kurs": "Kurs", "andere": "abwesend"}


def _norm(v: Any) -> Any:
    if v is None or v == "":
        return None
    if isinstance(v, (date, datetime)):
        return v.isoformat()[:10]
    return str(v)


async def _own_person(conn: Any, person_id: Any, user: CurrentUser) -> bool:
    if not person_id:
        return False
    row = await (
        await conn.execute(
            "select 1 from duty_people where id = %s and lower(email) = lower(%s) and deleted_at is null",
            (person_id, user.email),
        )
    ).fetchone()
    return row is not None


async def _old(conn: Any, table: str, row_id: Any) -> dict[str, Any] | None:
    cur = await conn.execute(f'select * from "{table}" where id = %s', (row_id,))
    found = await cur.fetchone()
    return {d.name: v for d, v in zip(cur.description, found)} if found else None


async def guard(conn: Any, table: str, row: dict[str, Any], user: CurrentUser) -> str | None:
    if table not in ("duty_requests", "duty_absences") or DIENSTE_WRITE in user.permissions:
        return None
    if table == "duty_absences":
        return await _guard_absence(conn, row, user)
    old = await _old(conn, "duty_requests", row.get("id"))
    if await _own_person(conn, row.get("person_id"), user):
        return _requester(row, old)
    if old and await _own_person(conn, old.get("to_person"), user):
        return _counterpart(row, old)
    return "Anträge nur für die eigene Person (E-Mail bei der Person eintragen lassen)"


def _requester(row: dict[str, Any], old: dict[str, Any] | None) -> str | None:
    if row.get("status") not in OFFENE_STATUS:
        return "Bestätigen und Ablehnen macht das Büro"
    if row.get("decided_by") or row.get("decided_at") or row.get("decision_note"):
        return "Bestätigen und Ablehnen macht das Büro"
    if old is None:
        wants = "offen" if row.get("to_person") and row.get("kind") in ("tausch", "abgabe") else None
        if _norm(row.get("counter_status")) != wants:
            return "Zustimmen kann nur die Gegenpartei"
        return None
    if _norm(old.get("person_id")) != _norm(row.get("person_id")):
        return "Der Antrag gehört einer anderen Person"
    if old.get("status") != "offen":
        return "Der Antrag ist schon entschieden"
    if _norm(old.get("counter_status")) != _norm(row.get("counter_status")):
        return "Zustimmen kann nur die Gegenpartei"
    return None


def _counterpart(row: dict[str, Any], old: dict[str, Any]) -> str | None:
    if old.get("status") != "offen" or old.get("counter_status") != "offen":
        return "Der Antrag ist schon entschieden"
    if row.get("counter_status") not in ("zugestimmt", "abgelehnt"):
        return "Als Gegenpartei nur zustimmen oder ablehnen"
    if any(_norm(old.get(c)) != _norm(row.get(c)) for c in FIXED) or row.get("deleted_at"):
        return "Als Gegenpartei nur zustimmen oder ablehnen"
    if row.get("decided_by") or row.get("decided_at") or row.get("decision_note"):
        return "Bestätigen und Ablehnen macht das Büro"
    return None


async def _guard_absence(conn: Any, row: dict[str, Any], user: CurrentUser) -> str | None:
    """Ohne Dienstplan-Recht: nur «krank» und nur für sich selbst (Ferien, Frei, Kurs
    laufen als Antrag über duty_requests). Bestehende Einträge anderer oder anderer
    Art bleiben unangetastet."""
    if row.get("kind") != "krank":
        return "Ferien, Frei und Kurs beantragen (das Büro bestätigt); direkt eintragen nur «krank»"
    if not await _own_person(conn, row.get("person_id"), user):
        return "Abwesenheit nur für die eigene Person"
    old = await (await conn.execute("select person_id, kind from duty_absences where id = %s", (row.get("id"),))).fetchone()
    if old is not None and (str(old[0]) != str(row.get("person_id")) or old[1] != "krank"):
        return "Diese Abwesenheit ändert das Büro"
    return None


# --- nach dem Schreiben ---------------------------------------------------------

async def _person(conn: Any, pid: Any) -> tuple[str, str | None]:
    if not pid:
        return ("jemand", None)
    r = await (await conn.execute("select name, email from duty_people where id = %s", (pid,))).fetchone()
    return (r[0], r[1]) if r else ("jemand", None)


async def _duty(conn: Any, type_id: Any, day: Any) -> str:
    r = await (await conn.execute("select name, animal from duty_types where id = %s", (type_id,))).fetchone() if type_id else None
    name = (f"{r[1]} · {r[0]}" if r and r[1] else r[0]) if r else "Dienst"
    d = day if isinstance(day, date) else (date.fromisoformat(str(day)[:10]) if day else None)
    return f"{d.day}.{d.month}. {name}" if d else name


async def _describe(conn: Any, r: dict[str, Any]) -> str:
    who, _ = await _person(conn, r.get("person_id"))
    kind = r.get("kind")
    if kind == "wunsch":
        f, t = r.get("from_date"), r.get("to_date")
        rng = f"{_dm(f)}–{_dm(t)}" if f and t and _norm(f) != _norm(t) else _dm(f)
        return f"{who} beantragt {KIND_LABEL.get(r.get('absence_kind') or 'frei', 'frei')}: {rng}"
    mine = await _duty(conn, r.get("type_id"), r.get("date"))
    other, _ = await _person(conn, r.get("to_person"))
    if kind == "abgabe":
        return f"{who} gibt ab: {mine}" + (f" an {other}" if r.get("to_person") else "")
    theirs = await _duty(conn, r.get("other_type_id"), r.get("other_date"))
    return f"{who} tauscht {mine} gegen {other}: {theirs}"


def _dm(v: Any) -> str:
    n = _norm(v)
    return f"{int(n[8:10])}.{int(n[5:7])}." if n else ""


async def after_write(conn: Any, table: str, row: dict[str, Any], old: dict[str, Any] | None, user: CurrentUser) -> None:
    if table != "duty_requests":
        return
    office = await office_emails(conn, DIENSTE_WRITE)
    _, requester = await _person(conn, row.get("person_id"))
    _, counter = await _person(conn, row.get("to_person"))
    text = await _describe(conn, row)

    if old is None:
        if row.get("counter_status") == "offen":
            await notify(conn, [counter], "abtausch", "Abtausch: deine Zustimmung", f"{text}. Bitte zustimmen oder ablehnen.", LINK, actor=user.email)
        elif row.get("status") == "offen":
            await notify(conn, office, "antrag", "Neuer Antrag im Dienstplan", text, LINK, actor=user.email)
        return

    if old.get("counter_status") == "offen" and row.get("counter_status") == "zugestimmt" and row.get("status") == "offen":
        done = await _execute_swap(conn, row, user)
        if done:
            await notify(conn, [requester], "abtausch", "Abtausch ist gültig", f"{text}: zugestimmt, der Plan ist geändert.", LINK, actor=user.email)
            await notify(conn, office, "abtausch", "Abtausch erfolgt (Zustimmung)", text, LINK, actor=user.email)
        else:
            await notify(conn, [requester, *office], "konflikt", "Abtausch nicht mehr möglich", f"{text}: zugestimmt, aber der Plan hat sich inzwischen geändert. Das Büro entscheidet.", LINK, actor=user.email)
        return
    if old.get("counter_status") == "offen" and row.get("counter_status") == "abgelehnt":
        await notify(conn, [requester, *office], "konflikt", "Abtausch abgelehnt: Büro entscheidet", f"{text}: die Gegenpartei hat abgelehnt.", LINK, actor=user.email)
        return
    if old.get("status") == "offen" and row.get("status") == "zurueckgezogen":
        if row.get("counter_status") == "offen":
            await notify(conn, [counter], "abtausch", "Abtausch zurückgezogen", text, LINK, actor=user.email)
        return
    if old.get("status") == "offen" and row.get("status") in ("bestaetigt", "abgelehnt"):
        verb = "bestätigt" if row["status"] == "bestaetigt" else "abgelehnt"
        note = f" «{row.get('decision_note')}»" if row.get("decision_note") else ""
        await notify(conn, [requester, counter], "entscheid", f"Antrag {verb}", f"{text}: vom Büro {verb}.{note}", LINK, actor=user.email)


async def _execute_swap(conn: Any, r: dict[str, Any], user: CurrentUser) -> bool:
    """Tausch bzw. Übernahme im Plan ausführen, wenn er noch passt. False = Plan hat sich geändert."""
    a = await (await conn.execute("select id, person_id, date, type_id from duty_shifts where id = %s and deleted_at is null", (r.get("shift_id"),))).fetchone()
    if a is None or _norm(a[1]) != _norm(r.get("person_id")) or not r.get("to_person"):
        return False
    b = None
    if r.get("kind") == "tausch":
        b = await (await conn.execute("select id, person_id, date, type_id from duty_shifts where id = %s and deleted_at is null", (r.get("other_shift_id"),))).fetchone()
        if b is None or _norm(b[1]) != _norm(r.get("to_person")):
            return False
    by = f"{user.email} (Zustimmung)"
    moves = [(a, r["to_person"])] + ([(b, r["person_id"])] if b else [])
    for shift, to in moves:
        await conn.execute("update duty_shifts set person_id = %s, assigned_by = %s, updated_at = clock_timestamp() where id = %s", (to, by, shift[0]))
        await conn.execute(
            "insert into duty_changes (id, shift_id, date, type_id, from_person, to_person, kind, changed_by, changed_at, notes, updated_at) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, clock_timestamp(), %s, clock_timestamp())",
            (str(uuidlib.uuid4()), shift[0], shift[2], shift[3], shift[1], to, "tausch" if b else "abgabe", by, r.get("notes")),
        )
        await _history(conn, "duty_shifts", shift[0], by)
    await conn.execute(
        "update duty_requests set status = 'bestaetigt', decided_by = %s, decided_at = clock_timestamp(), "
        # neuer als der Stand des Geräts, auch wenn dessen Uhr vorgeht (sonst gewinnt beim Pull dessen Fassung)
        "decision_note = 'Zustimmung der Gegenpartei', updated_at = greatest(clock_timestamp(), %s::timestamptz + interval '1 millisecond') where id = %s",
        (by, r.get("updated_at"), r["id"]),
    )
    await _history(conn, "duty_requests", r["id"], by)
    return True


async def _history(conn: Any, table: str, row_id: Any, by: str) -> None:
    """Verlauf wie bei Änderungen aus der App (data_history), Stand nach der Änderung."""
    snap = await (await conn.execute(f'select row_to_json(t)::text from "{table}" t where id = %s', (row_id,))).fetchone()
    await conn.execute(
        "insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at) "
        "values (%s, %s, %s, 'update', %s, clock_timestamp(), %s, clock_timestamp())",
        (str(uuidlib.uuid4()), table, row_id, by, snap[0] if snap else json.dumps({})),
    )
