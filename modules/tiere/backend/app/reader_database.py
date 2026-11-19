"""Tierinfos als Datenbank aufs Lesegerät senden (Menü am Gerät: Daten → Suche per EID in DB).

Format aus Select Sheepware und ADT abgelesen und am echten APR600 bestätigt: `XEDATASETS` leert die Datensätze,
`XIDB|<Anzahl Felder>` legt die Datenbank neu an, je Feld `XIDBFIELD|<Nr>|<Titel>|<Breite>|<Flag>|<Typ>` (Typ 9 = VID,
das erscheint nach dem Lesen; 3 = Text; 21 = Alarm), je Tier `XADATASET|<Ohrmarke als Hex>|1|<Wert 1>|2|<Wert 2>|…` mit der
Feldnummer vor jedem Wert (leere Werte entfallen). Mit `XGDATASET|<n>` liest man Datensatz n zurück:
`[<Ohrmarke 16 Ziffern>|<Wert 1>|…|<Wert N>]`.

Eine Datenbank auf dem Gerät hat Vorrang vor der Link-Liste (Handbuch); die VID kommt dann aus Feld 1.
Ablauf wie bei der Link-Liste (reader_lists.py): bisherigen Stand sichern → ersetzen → Datensatz für Datensatz zurücklesen
und vergleichen → bei Abweichung den alten Stand wieder aufspielen."""

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.agrident import ReaderBusyError, ReaderError, acquire_reader
from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.reader_scan import resolve_reader
from modules.tiere.backend.app import reader_pools
from modules.tiere.backend.app.reader_lists import device_eid, hex_eid, hex_from_device

router = APIRouter()
WRITE = "tiere:herden:write"
MAX_FIELDS = 50
MAX_ROWS = 20_000  # Platz der Datenbank im Gerät
MAX_WIDTH = 40
MAX_TITLE = 20
ALLOWED_TYPES = {0, 3, 9, 21}  # 0/3 Text, 9 VID, 21 Alarm
_BAD = re.compile(r"[\[\]|\x00-\x1f\x7f]")


class Field(BaseModel):
    title: str
    width: int
    flag: int = 0
    type: int = 3


class Row(BaseModel):
    iso: str  # 15 Ziffern: Landescode + nationale Nummer
    values: list[str]  # je Feld einer (Feld 1 = VID)


def _check_text(text: str, what: str) -> None:
    if _BAD.search(text):
        raise ValueError(f"{what} {text!r} enthält ein unerlaubtes Zeichen")
    try:
        text.encode("latin-1")
    except UnicodeEncodeError:
        raise ValueError(f"{what} {text!r} hat Zeichen, die das Gerät nicht anzeigt") from None


def validate(fields: list[Field], rows: list[Row]) -> None:
    if not fields or len(fields) > MAX_FIELDS:
        raise ValueError(f"Die Datenbank braucht 1 bis {MAX_FIELDS} Felder")
    if fields[0].type != 9:
        raise ValueError("Feld 1 muss die VID sein (Typ 9): sie erscheint nach dem Lesen")
    for f in fields:
        if not f.title or len(f.title) > MAX_TITLE:
            raise ValueError(f"Feldtitel {f.title!r}: 1 bis {MAX_TITLE} Zeichen")
        _check_text(f.title, "Feldtitel")
        if f.type not in ALLOWED_TYPES:
            raise ValueError(f"Feldtyp {f.type} ist nicht bekannt")
        if not 0 <= f.width <= MAX_WIDTH:
            raise ValueError(f"Feldbreite {f.width} ausserhalb 0 bis {MAX_WIDTH}")
    if not rows:
        raise ValueError("Keine Tiere")
    if len(rows) > MAX_ROWS:
        raise ValueError(f"Zu viele Tiere ({len(rows)}), das Gerät fasst {MAX_ROWS}")
    seen: set[str] = set()
    for r in rows:
        hex_eid(r.iso)
        if r.iso in seen:
            raise ValueError(f"Ohrmarke {r.iso} doppelt")
        seen.add(r.iso)
        if len(r.values) != len(fields):
            raise ValueError(f"Ohrmarke {r.iso}: {len(r.values)} Werte für {len(fields)} Felder")
        for f, v in zip(fields, r.values):
            _check_text(v, "Wert")
            if f.width and len(v) > f.width:
                raise ValueError(f"Wert {v!r} ist länger als das Feld «{f.title}» ({f.width})")
        if not r.values[0]:
            raise ValueError(f"Ohrmarke {r.iso}: die VID (Feld 1) darf nicht leer sein")


def xadataset_args(iso_hex: str, values: list[str]) -> list[str]:
    """Argumente von XADATASET: Ohrmarke, dann Feldnummer und Wert (leere Werte entfallen)."""
    out = [iso_hex]
    for i, v in enumerate(values, start=1):
        if v != "":
            out += [str(i), v]
    return out


def parse_fields(raw: str) -> list[Field]:
    """Antwort von XGDBFIELD: `[Nr|Titel|Breite|Flag|Typ|0]` je Feld."""
    out = []
    for m in re.finditer(r"\[(\d+)\|([^\]|]*)\|(\d+)\|(\d+)\|(\d+)(?:\|\d+)?\]", raw):
        out.append(Field(title=m.group(2), width=int(m.group(3)), flag=int(m.group(4)), type=int(m.group(5))))
    return out


def parse_record(raw: str) -> tuple[str, list[str]] | None:
    """Antwort von XGDATASET|n → (Ohrmarke 16 Ziffern, Werte) oder None, wenn es den Datensatz nicht gibt."""
    m = re.search(r"\[(\d{16})((?:\|[^\]|]*)*)\]", raw)
    if not m:
        return None
    return m.group(1), m.group(2).split("|")[1:]


def _same(values: list[str], wanted: list[str]) -> bool:
    return [v.rstrip() for v in values][: len(wanted)] == [v.rstrip() for v in wanted] and not any(values[len(wanted):])


async def _count(conn: Any) -> int:
    m = re.search(r"\](\d+)\|(\d+)\|(\d+)\|(\d+)", await conn.send_command("XGDBSTAT"))
    return int(m.group(3)) if m else 0


async def _write(conn: Any, fields: list[Field], rows: list[tuple[str, list[str]]]) -> None:
    """Leert, legt die Felder an und schreibt jedes Tier; `rows` = (Ohrmarke als Hex, Werte)."""
    await conn.send_command("XEDATASETS", timeout=15.0)
    await conn.send_command("XIDB", str(len(fields)), timeout=15.0)
    for i, f in enumerate(fields, start=1):
        await conn.send_command("XIDBFIELD", str(i), f.title, str(f.width), str(f.flag), str(f.type), encoding="latin-1")
    for iso_hex, values in rows:
        await conn.send_command("XADATASET", *xadataset_args(iso_hex, values), encoding="latin-1")


async def _read_all(conn: Any, count: int) -> dict[str, list[str]]:
    got: dict[str, list[str]] = {}
    for n in range(1, count + 1):
        rec = parse_record(await conn.send_command("XGDATASET", str(n), encoding="latin-1"))
        if rec:
            got[rec[0]] = rec[1]
    return got


async def replace_database(conn: Any, fields: list[Field], rows: list[Row]) -> dict[str, Any]:
    """Alte Datenbank sichern, durch die neue ersetzen, jeden Datensatz zurücklesen und vergleichen; bei Abweichung
    den alten Stand wieder aufspielen. Gibt {sent, verified, backup_*} zurück oder wirft ReaderError."""
    validate(fields, rows)
    old_fields = parse_fields(await conn.send_command("XGDBFIELD", timeout=10.0, encoding="latin-1"))
    old_count = await _count(conn)
    old_rows = await _read_all(conn, old_count)
    backup = "## Felder\n" + "\n".join(f"{i}|{f.title}|{f.width}|{f.flag}|{f.type}" for i, f in enumerate(old_fields, start=1))
    backup += "\n## Datensätze\n" + "\n".join(f"{eid}|" + "|".join(vals) for eid, vals in old_rows.items())
    wanted = {device_eid(r.iso): r.values for r in rows}

    async def restore() -> None:
        if old_fields:
            await _write(conn, old_fields, [(hex_from_device(eid), vals + [""] * (len(old_fields) - len(vals))) for eid, vals in old_rows.items()])
        else:
            await conn.send_command("XEDATASETS", timeout=15.0)

    try:
        await _write(conn, fields, [(hex_eid(r.iso), r.values) for r in rows])
        got = await _read_all(conn, await _count(conn))
    except Exception:
        await restore()
        raise
    wrong = [k for k, v in wanted.items() if k not in got or not _same(got[k], v)]
    extra = [k for k in got if k not in wanted]
    if wrong or extra:
        await restore()
        raise ReaderError(f"Die Datenbank auf dem Gerät stimmt nicht mit der gesendeten überein ({len(wrong)} falsch, {len(extra)} zu viel); der alte Stand ist wieder aufgespielt")
    new_fields = parse_fields(await conn.send_command("XGDBFIELD", timeout=10.0, encoding="latin-1"))
    if [(f.title, f.width, f.type) for f in new_fields] != [(f.title, f.width, f.type) for f in fields]:
        await restore()
        raise ReaderError("Die Felder auf dem Gerät stimmen nicht mit den gesendeten überein; der alte Stand ist wieder aufgespielt")
    return {"sent": len(rows), "verified": len(got), "fields": len(fields), "backup": backup, "backup_rows": len(old_rows), "backup_fields": len(old_fields)}


class DatabaseBody(BaseModel):
    fields: list[Field]
    rows: list[Row]


@router.post("/reader/database")
async def send_database(body: DatabaseBody, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    if WRITE not in user.permissions:
        raise HTTPException(status_code=403, detail="Das Lesegerät beschreiben braucht das Recht Tiergruppen")
    try:
        validate(body.fields, body.rows)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    resolved = await resolve_reader("tiere")
    if resolved is None:
        raise HTTPException(status_code=409, detail="Kein Lesegerät aktiviert (Verwaltung → Module)")
    _, host, port = resolved
    async with reader_pools._lock:
        try:
            async with acquire_reader(host, port) as conn:
                return {"ok": True, **await replace_database(conn, body.fields, body.rows)}
        except ReaderBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (ReaderError, OSError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
