"""Link-Liste (Ohrmarke → sichtbare Nummer VID) direkt aufs Lesegerät senden.

AgriLink lädt die Liste so (aus AgriLink.exe abgelesen, am echten Gerät bestätigt): `XETAGLIST` löscht die Liste,
dann je Tier eine rohe Zeile `[E<16 Hex-Ziffern>|<VID>|<Alarmnummer>]` (kein Befehlsname; das Gerät schickt die Zeile als
Echo zurück). Die Ohrmarke steht als Hex-Zahl (Landescode << 38 | nationale Nummer); `XGTAGLIST` liefert sie wieder als
`E` + 4-stelliger Landescode + 12-stellige Nummer, z.B. E0756000019678802.

Ablauf: aktuelle Liste sichern → ersetzen → zurücklesen und vergleichen. Stimmt etwas nicht, wird die gesicherte Liste
wieder aufgespielt. Die Alarmliste (Alarmnummer → Text) fasst das hier nicht an: darum gehen die Einträge mit
Alarmnummer 0 raus, sonst zeigte das Gerät Texte der alten Alarmliste."""

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.agrident import ReaderBusyError, ReaderError, acquire_reader
from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.reader_scan import resolve_reader
from modules.tiere.backend.app import reader_pools

router = APIRouter()
WRITE = "tiere:herden:write"
MAX_ENTRIES = 10_000  # Platz der Link-Liste im Gerät
MAX_VID = 20
MAX_ALERT = 250
_BAD_VID = re.compile(r"[\[\]|\x00-\x1f\x7f]")
_ENTRY = re.compile(r"\[E(\d{16})\|([^\]|]*)(?:\|(\d+))?\]")


class Entry(BaseModel):
    iso: str  # 15 Ziffern: Landescode (3) + nationale Nummer (12), z.B. 756000019678802
    vid: str
    alert: int = 0


def hex_eid(iso: str) -> str:
    """15 Ziffern (z.B. 756000019678802) → 16 Hex-Ziffern, wie sie das Gerät beim Hochladen will."""
    if not re.fullmatch(r"\d{15}", iso):
        raise ValueError(f"Ohrmarke {iso!r} ist nicht 15-stellig")
    return f"{(int(iso[:3]) << 38) | int(iso[3:]):016X}"


def device_eid(iso: str) -> str:
    """So meldet das Gerät dieselbe Ohrmarke zurück: 4-stelliger Landescode + 12-stellige Nummer."""
    return f"{int(iso[:3]):04d}{int(iso[3:]):012d}"


def hex_from_device(eid16: str) -> str:
    """Rückweg (Sicherung zurückspielen): 0756000019678802 → Hex."""
    return f"{(int(eid16[:4]) << 38) | int(eid16[4:]):016X}"


def validate(entries: list[Entry]) -> None:
    if not entries:
        raise ValueError("Keine Einträge")
    if len(entries) > MAX_ENTRIES:
        raise ValueError(f"Zu viele Einträge ({len(entries)}), das Gerät fasst {MAX_ENTRIES}")
    seen: set[str] = set()
    for e in entries:
        hex_eid(e.iso)
        if e.iso in seen:
            raise ValueError(f"Ohrmarke {e.iso} doppelt")
        seen.add(e.iso)
        if len(e.vid) > MAX_VID:
            raise ValueError(f"VID {e.vid!r} ist länger als {MAX_VID} Zeichen")
        if _BAD_VID.search(e.vid):
            raise ValueError(f"VID {e.vid!r} enthält ein unerlaubtes Zeichen")
        try:
            e.vid.encode("latin-1")
        except UnicodeEncodeError:
            raise ValueError(f"VID {e.vid!r} hat Zeichen, die das Gerät nicht anzeigt") from None
        if not 0 <= e.alert <= MAX_ALERT:
            raise ValueError(f"Alarmnummer {e.alert} ausserhalb 0 bis {MAX_ALERT}")


def line_for(e: Entry) -> str:
    return f"[E{hex_eid(e.iso)}|{e.vid}|{e.alert}]"


def parse_device_list(raw: str) -> dict[str, tuple[str, int]]:
    """Antwort von XGTAGLIST → {16-stellige Geräte-Ohrmarke: (VID, Alarmnummer)}."""
    return {m.group(1): (m.group(2), int(m.group(3) or 0)) for m in _ENTRY.finditer(raw)}


async def _upload(conn: Any, lines: list[str]) -> list[str]:
    """Sendet die Zeilen; gibt die zurück, deren Echo ausblieb (das Zurücklesen prüft ohnehin alles)."""
    missed = []
    for ln in lines:
        if not await conn.send_line(ln):
            missed.append(ln)
    return missed


async def replace_link_list(conn: Any, entries: list[Entry]) -> dict[str, Any]:
    """Aktuelle Liste sichern, durch `entries` ersetzen, zurücklesen und vergleichen; bei Abweichung die Sicherung
    zurückspielen. Gibt {sent, verified, backup} zurück oder wirft ReaderError."""
    validate(entries)
    backup_raw = await conn.send_command("XGTAGLIST", timeout=15.0, encoding="latin-1")
    backup = parse_device_list(backup_raw)
    wanted = {device_eid(e.iso): (e.vid, e.alert) for e in entries}

    async def restore() -> None:
        await conn.send_command("XETAGLIST", timeout=15.0)
        await _upload(conn, [f"[E{hex_from_device(k)}|{v}|{a}]" for k, (v, a) in backup.items()])

    try:
        await conn.send_command("XETAGLIST", timeout=15.0)
        await _upload(conn, [line_for(e) for e in entries])
        got = parse_device_list(await conn.send_command("XGTAGLIST", timeout=15.0, encoding="latin-1"))
    except Exception:
        await restore()
        raise
    if got != wanted:
        wrong = [k for k in wanted if got.get(k) != wanted[k]]
        extra = [k for k in got if k not in wanted]
        await restore()
        raise ReaderError(f"Die Liste auf dem Gerät stimmt nicht mit der gesendeten überein ({len(wrong)} falsch, {len(extra)} zu viel); die alte Liste ist wieder aufgespielt")
    return {"sent": len(entries), "verified": len(got), "backup": backup_raw.strip(), "backup_entries": len(backup)}


class LinkListBody(BaseModel):
    entries: list[Entry]


@router.post("/reader/linklist")
async def send_link_list(body: LinkListBody, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    if WRITE not in user.permissions:
        raise HTTPException(status_code=403, detail="Das Lesegerät beschreiben braucht das Recht Tiergruppen")
    try:
        validate(body.entries)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    resolved = await resolve_reader("tiere")
    if resolved is None:
        raise HTTPException(status_code=409, detail="Kein Lesegerät aktiviert (Verwaltung → Module)")
    _, host, port = resolved
    # gleiche Sperre wie die Abfrage der Gruppen: nie zwei Verbindungen zugleich
    async with reader_pools._lock:
        try:
            async with acquire_reader(host, port) as conn:
                return {"ok": True, **await replace_link_list(conn, body.entries)}
        except ReaderBusyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (ReaderError, OSError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
