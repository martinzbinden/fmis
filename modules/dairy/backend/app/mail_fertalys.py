"""FERTALYS-Resultate per Mail (Trächtigkeitstest aus der Milchprobe, swissherdbook/Holstein über cownect/Qualitas),
abgeholt vom Mail-Abruf von FMIS (core/backend/fmis_core/mailbox.py).

Die Mail enthält je Zeile «NAME Trächtig» bzw. «NAME Nicht trächtig», ohne Ohrmarke und ohne Probedatum. Je Zeile
ein Trächtigkeitsbefund (pregnancy_checks, Methode «fertalys», ohne Durchgang). Zuordnung über den Tiernamen
(aktive weibliche Tiere), Datum = letzte Milchprobe der Kuh bis zum Mail-Datum (höchstens 6 Wochen davor), sonst
das Mail-Datum. Gleiches Tier + Datum + FERTALYS wird korrigiert statt verdoppelt. Zeilen ohne eindeutiges Tier werden
nicht gespeichert, sondern als Hinweis in der Verwaltung (Mail) gezeigt.

Gleiche Regeln wie im Browser (frontend/src/lib/fertalys.ts, «FERTALYS-Mail einfügen»). Nur Rindvieh (dairy).
"""

import datetime as dt
import json
import re
import unicodedata
import uuid as uuidlib
from typing import Any

from core.backend.fmis_core.db import get_pool
from core.backend.fmis_core.mailbox import Handler, Mail

SAMPLE_MAX_DAYS = 42

_LINE = re.compile(r"^\s*(.+?)\s+(nicht\s+tr[äa]chtig|tr[äa]chtig|fraglich|zweifelhaft|unsicher|unklar|wiederholen.*|nachkontrolle.*)\s*$", re.I)
_MONTHS = {"jan": 1, "feb": 2, "mär": 3, "mae": 3, "mar": 3, "apr": 4, "mai": 5, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "okt": 10, "oct": 10, "nov": 11, "dez": 12, "dec": 12}


def _result(word: str) -> str | None:
    w = re.sub(r"\s+", " ", word.strip().lower())
    if re.fullmatch(r"nicht tr[äa]chtig", w):
        return "nein"
    if re.fullmatch(r"tr[äa]chtig", w):
        return "ja"
    if re.match(r"(fraglich|zweifelhaft|unsicher|unklar|wiederholen|nachkontrolle)\b", w):
        return "unsicher"
    return None


def parse_fertalys(text: str) -> list[dict[str, str]]:
    """Zeilen mit Name + Resultat; Anrede, Grüsse und Fliesstext fallen weg, «> » vor zitierten Zeilen auch."""
    out = []
    for raw in text.splitlines():
        m = _LINE.match(re.sub(r"^[>\s]+", "", raw).rstrip())
        if not m:
            continue
        name = re.sub(r"[:\-–·|]+$", "", m.group(1)).strip()
        if not name or len(name.split()) > 3 or re.search(r"[.,!?]", name):
            continue
        res = _result(m.group(2))
        if res:
            out.append({"name": name, "result": res, "text": m.group(2).strip()})
    return out


def parse_mail_date(text: str, today: dt.date) -> dt.date | None:
    """«26.08.2026», «26. Aug. 2026» oder «Mi., 26. Aug., 16:20» (ohne Jahr: das letzte solche Datum bis heute)."""
    try:
        m = re.search(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b", text)
        if m:
            return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        m = re.search(r"\b(\d{1,2})\.\s*([A-Za-zÄäÖöÜü]{3})[a-zäöü]*\.?,?\s*(\d{4})?", text)
        if not m or m.group(2).lower() not in _MONTHS:
            return None
        mo, d = _MONTHS[m.group(2).lower()], int(m.group(1))
        if m.group(3):
            return dt.date(int(m.group(3)), mo, d)
        guess = dt.date(today.year, mo, d)
        return guess if guess <= today else dt.date(today.year - 1, mo, d)
    except ValueError:
        return None


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.upper())
    return re.sub(r"\s+", " ", "".join(c for c in s if unicodedata.category(c) != "Mn")).strip()


async def _history(conn: Any, row_id: Any) -> None:
    snap = await (await conn.execute("select row_to_json(t)::text from pregnancy_checks t where id = %s", (row_id,))).fetchone()
    await conn.execute(
        "insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at) "
        "values (%s, 'pregnancy_checks', %s, 'update', 'FERTALYS-Mail', clock_timestamp(), %s, clock_timestamp())",
        (str(uuidlib.uuid4()), row_id, snap[0] if snap else json.dumps({})),
    )


async def apply_lines(conn: Any, lines: list[dict[str, str]], mail_date: dt.date) -> tuple[int, list[str]]:
    """Zeilen speichern; gibt (gespeichert, Hinweise) zurück."""
    animals = await (await conn.execute("select id, name from animals where deleted_at is null and status = 'aktiv' and coalesce(sex, 'w') = 'w' and name is not null")).fetchall()
    by_name: dict[str, list[Any]] = {}
    for aid, name in animals:
        by_name.setdefault(_norm(name), []).append(aid)
    saved, problems = 0, []
    for ln in lines:
        hits = by_name.get(_norm(ln["name"]), [])
        if len(hits) != 1:
            problems.append(f"{ln['name']} {ln['text']}: {'kein aktives Tier mit diesem Namen' if not hits else f'{len(hits)} Tiere mit diesem Namen'}")
            continue
        aid = hits[0]
        row = await (await conn.execute("select max(test_date) from milk_tests where deleted_at is null and animal_id = %s and test_date <= %s", (aid, mail_date))).fetchone()
        sample = row[0] if row else None
        date = sample if sample and (mail_date - sample).days <= SAMPLE_MAX_DAYS else mail_date
        note = f"FERTALYS-Mail {mail_date.strftime('%d.%m.%Y')}: {ln['text']}"
        old = await (await conn.execute("select id from pregnancy_checks where deleted_at is null and method = 'fertalys' and animal_id = %s and check_date = %s", (aid, date))).fetchone()
        if old:
            rid = old[0]
            await conn.execute("update pregnancy_checks set result = %s, notes = %s, updated_at = clock_timestamp() where id = %s", (ln["result"], note, rid))
        else:
            rid = str(uuidlib.uuid4())
            await conn.execute(
                "insert into pregnancy_checks (id, animal_id, check_date, result, source, round_id, examiner, method, duration_unit, notes, recorded_at, created_by, updated_at) "
                "values (%s, %s, %s, %s, 'manual', null, 'FERTALYS', 'fertalys', 'wochen', %s, clock_timestamp(), 'FERTALYS-Mail', clock_timestamp())",
                (rid, aid, date, ln["result"], note),
            )
        await _history(conn, rid)
        saved += 1
    return saved, problems


def fertalys_handler(key: str) -> Handler:
    """Handler für die Rindvieh-Instanz `key` (Mails mit «FERTALYS» und mindestens einer Resultatzeile)."""
    pool = get_pool(key)

    def matches(mail: Mail) -> bool:
        return "FERTALYS" in (mail.subject + "\n" + mail.text).upper() and bool(parse_fertalys(mail.text))

    async def handle(mail: Mail) -> tuple[int, list[str], dt.date | None]:
        head = mail.received.date() if mail.received else dt.date.today()
        # weitergeleitet: Datum der ursprünglichen Mail aus dem Text, nicht später als die Weiterleitung
        body = parse_mail_date(mail.text, head)
        mail_date = body if body and body <= head else head
        async with pool.connection() as conn:
            n, problems = await apply_lines(conn, parse_fertalys(mail.text), mail_date)
            await conn.commit()
        return n, problems, mail_date

    return Handler(name=f"{key}:fertalys", label="FERTALYS (Trächtigkeit Rindvieh)", matches=matches, handle=handle)
