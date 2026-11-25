"""Mail-Abruf für FMIS: ein Postfach (z.B. fmis@riedackerhof.ch), aus dem der Server alle paar Minuten Mails holt
und an die Module verteilt, die sich dafür angemeldet haben (register()). Erstes Modul: FERTALYS-Resultate
(modules/dairy/backend/app/mail_fertalys.py).

- Nur lesen: Ordner readonly, BODY.PEEK (nichts wird als gelesen markiert, gelöscht oder verschoben).
- Nur Mails erlaubter Absender (Adresse oder «@domain»); jede Mail nur einmal (Message-ID in mail_inbox).
  Mails, die kein Modul will, werden nicht gespeichert.
- Weitergeleitete Mails: Text inkl. weitergeleiteter Teile; das Datum der ursprünglichen Mail sucht das Modul selbst.
- Zugangsdaten (Tabelle mail_link) sind Einstellungen der Instanz, nie im Repo; das Passwort wird nie ausgegeben.
- Testumgebung (FMIS_INSTANZ=dev, Daten von Prod): kein Abruf im Hintergrund, nur auf Knopfdruck.
"""

import asyncio
import datetime as dt
import email
import email.policy
import hashlib
import html
import imaplib
import json
import logging
import os
import re
from dataclasses import dataclass
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import CurrentUser, require_auth
from .db import get_pool

# uvicorn.error: erscheint im Server-Log (docker logs), anders als eigene Logger auf Stufe INFO
log = logging.getLogger("uvicorn.error")
router = APIRouter()

ADMIN = "core:modules:manage"
TIMEOUT_S = 30
LOOKBACK_DAYS = 60
_lock = asyncio.Lock()


@dataclass
class Mail:
    message_id: str
    sender: str
    subject: str
    received: dt.datetime | None
    text: str


@dataclass
class Handler:
    """Ein Modul, das bestimmte Mails verarbeitet."""

    name: str
    label: str
    matches: Callable[[Mail], bool]
    # gibt (gespeichert, Hinweise) und das Datum der Mail zurück
    handle: Callable[[Mail], Awaitable[tuple[int, list[str], dt.date | None]]]


HANDLERS: list[Handler] = []


def register(h: Handler) -> None:
    if all(x.name != h.name for x in HANDLERS):
        HANDLERS.append(h)


def sender_allowed(sender: str, allowed: list[str]) -> bool:
    s = sender.strip().lower()
    for a in allowed:
        a = a.strip().lower()
        if a and (s == a or (a.startswith("@") and s.endswith(a))):
            return True
    return False


def body_text(msg: email.message.Message) -> str:
    """Text der Mail: alle text/plain-Teile (auch weitergeleitete); ohne solche das HTML ohne Auszeichnung."""
    plain: list[str] = []
    htmls: list[str] = []
    for part in msg.walk():
        ctype = part.get_content_type()
        if part.is_multipart() or ctype not in ("text/plain", "text/html") or part.get_content_disposition() == "attachment":
            continue
        try:
            content = part.get_content()
        except Exception:
            payload = part.get_payload(decode=True) or b""
            content = payload.decode(part.get_content_charset() or "utf-8", "replace")
        if ctype == "text/plain":
            plain.append(content)
        else:
            content = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>|</li>", "\n", content)
            htmls.append(html.unescape(re.sub(r"<[^>]+>", " ", content)))
    return "\n".join(plain or htmls)


async def _config(conn: Any) -> dict[str, Any] | None:
    row = await (await conn.execute("select host, port, username, password, folder, senders, poll_minutes from mail_link where id")).fetchone()
    if not row or not row[0] or not row[2] or not row[3]:
        return None
    return {"host": row[0], "port": row[1] or 993, "username": row[2], "password": row[3], "folder": row[4] or "INBOX", "senders": json.loads(row[5] or "[]"), "poll_minutes": row[6] or 30}


def _fetch(cfg: dict[str, Any], since: dt.date) -> list[bytes]:
    box = imaplib.IMAP4_SSL(cfg["host"], int(cfg["port"]), timeout=TIMEOUT_S)
    try:
        box.login(cfg["username"], cfg["password"])
        typ, _ = box.select(f'"{cfg["folder"]}"', readonly=True)
        if typ != "OK":
            raise RuntimeError(f"Ordner «{cfg['folder']}» nicht gefunden")
        typ, data = box.search(None, "SINCE", since.strftime("%d-%b-%Y"))
        if typ != "OK":
            raise RuntimeError("Suche im Postfach fehlgeschlagen")
        out = []
        for num in (data[0] or b"").split():
            typ, msg = box.fetch(num, "(BODY.PEEK[])")
            if typ == "OK" and msg and isinstance(msg[0], tuple):
                out.append(msg[0][1])
        return out
    finally:
        try:
            box.logout()
        except Exception:
            pass


async def poll() -> dict[str, Any]:
    async with _lock:
        pool = get_pool("public")
        async with pool.connection() as conn:
            cfg = await _config(conn)
            if not cfg:
                return {"configured": False}
            try:
                raw = await asyncio.to_thread(_fetch, cfg, dt.date.today() - dt.timedelta(days=LOOKBACK_DAYS))
            except Exception as e:  # Verbindung, Anmeldung, Ordner
                log.warning("Mail-Abruf: Postfach nicht erreichbar: %s", e)
                await conn.execute("update mail_link set last_poll_at = now(), last_error = %s where id", (str(e)[:300] or e.__class__.__name__,))
                await conn.commit()
                raise HTTPException(status_code=502, detail=f"Postfach: {e}") from None
            seen = {r[0] for r in await (await conn.execute("select message_id from mail_inbox")).fetchall()}
            mails = saved = known = foreign = unmatched = 0
            for data in raw:
                msg = email.message_from_bytes(data, policy=email.policy.default)
                mid = (str(msg.get("Message-ID") or "")).strip() or hashlib.sha256(data).hexdigest()
                if mid in seen:
                    known += 1
                    continue
                sender = parseaddr(str(msg.get("From") or ""))[1]
                if not sender_allowed(sender, cfg["senders"]):
                    foreign += 1
                    continue
                try:
                    received = parsedate_to_datetime(str(msg.get("Date")))
                except Exception:
                    received = None
                mail = Mail(mid, sender, str(msg.get("Subject") or "")[:200], received, body_text(msg))
                h = next((x for x in HANDLERS if x.matches(mail)), None)
                if not h:
                    unmatched += 1
                    continue
                try:
                    n, problems, mail_date = await h.handle(mail)
                except Exception as e:
                    log.exception("Mail %s (%s)", mid, h.name)
                    n, problems, mail_date = 0, [f"Fehler beim Verarbeiten: {e}"], None
                await conn.execute(
                    "insert into mail_inbox (message_id, handler, received_at, mail_date, sender, subject, saved, problems) values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing",
                    (mid, h.name, received, mail_date, sender, mail.subject, n, json.dumps(problems, ensure_ascii=False)),
                )
                mails += 1
                saved += n
                log.info("Mail-Abruf: %s → %s, %s gespeichert, %s Hinweise (Mail vom %s)", sender, h.name, n, len(problems), mail_date)
            await conn.execute("update mail_link set last_poll_at = now(), last_ok_at = now(), last_error = null where id")
            await conn.commit()
            # Absender werden nicht geloggt (nur gezählt); nicht gespeicherte Mails werden bei jedem Abruf neu geprüft
            log.info(
                "Mail-Abruf: %s Mails im Postfach (%s Tage), %s neu verarbeitet, %s Einträge; %s schon früher verarbeitet, %s Absender nicht erlaubt, %s für kein Modul",
                len(raw), LOOKBACK_DAYS, mails, saved, known, foreign, unmatched,
            )
            return {"configured": True, "mails": mails, "saved": saved, "total": len(raw), "known": known, "foreign": foreign, "unmatched": unmatched}


async def periodic() -> None:
    """Hintergrund: alle poll_minutes abrufen (nur wenn eingerichtet, nicht in der Testumgebung)."""
    if (os.environ.get("FMIS_INSTANZ") or "").strip() == "dev":
        return
    await asyncio.sleep(90)
    while True:
        minutes = 30
        try:
            async with get_pool("public").connection() as conn:
                cfg = await _config(conn)
            if cfg:
                minutes = max(5, int(cfg["poll_minutes"]))
                await poll()
        except HTTPException as e:
            log.warning("Mail-Abruf: %s", e.detail)
        except Exception:
            log.exception("Mail-Abruf")
        await asyncio.sleep(minutes * 60)


# --- Endpunkte (Verwaltung) ---------------------------------------------------------------


def _need(user: CurrentUser) -> None:
    if ADMIN not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Berechtigung")


class Settings(BaseModel):
    host: str = ""
    port: int = 993
    username: str = ""
    # leer = bisheriges Passwort behalten
    password: str = ""
    folder: str = "INBOX"
    senders: list[str] = []
    poll_minutes: int = 30


@router.get("/admin/mail")
async def get_settings(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    _need(user)
    async with get_pool("public").connection() as conn:
        row = await (
            await conn.execute(
                "select host, port, username, password is not null and password <> '', folder, senders, poll_minutes, last_poll_at, last_ok_at, last_error from mail_link where id"
            )
        ).fetchone()
        inbox = await (await conn.execute("select handler, mail_date, sender, subject, saved, problems, processed_at from mail_inbox order by processed_at desc limit 15")).fetchall()
    out: dict[str, Any] = {
        "host": "", "port": 993, "username": "", "has_password": False, "folder": "INBOX", "senders": [], "poll_minutes": 30,
        "last_poll_at": None, "last_ok_at": None, "last_error": None,
    }
    if row:
        out = {
            "host": row[0] or "", "port": row[1], "username": row[2] or "", "has_password": bool(row[3]), "folder": row[4], "senders": json.loads(row[5] or "[]"),
            "poll_minutes": row[6], "last_poll_at": row[7], "last_ok_at": row[8], "last_error": row[9],
        }
    labels = {h.name: h.label for h in HANDLERS}
    out["handlers"] = [{"name": h.name, "label": h.label} for h in HANDLERS]
    out["background"] = (os.environ.get("FMIS_INSTANZ") or "").strip() != "dev"
    out["recent"] = [
        {"handler": labels.get(r[0], r[0]), "mail_date": r[1], "sender": r[2], "subject": r[3], "saved": r[4], "problems": json.loads(r[5] or "[]"), "processed_at": r[6]}
        for r in inbox
    ]
    return out


@router.put("/admin/mail")
async def put_settings(body: Settings, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    _need(user)
    senders = sorted({s.strip().lower() for s in body.senders if s.strip()})
    async with get_pool("public").connection() as conn:
        await conn.execute(
            "insert into mail_link (id, host, port, username, password, folder, senders, poll_minutes, updated_by, updated_at) "
            "values (true, %s, %s, %s, nullif(%s, ''), %s, %s, %s, %s, now()) "
            "on conflict (id) do update set host = excluded.host, port = excluded.port, username = excluded.username, "
            "password = coalesce(excluded.password, mail_link.password), folder = excluded.folder, senders = excluded.senders, "
            "poll_minutes = excluded.poll_minutes, updated_by = excluded.updated_by, updated_at = now()",
            (
                body.host.strip() or None, max(1, min(body.port, 65535)), body.username.strip() or None, body.password,
                body.folder.strip() or "INBOX", json.dumps(senders), max(5, min(body.poll_minutes, 1440)), user.email,
            ),
        )
        await conn.commit()
    return await get_settings(user)


@router.delete("/admin/mail/password", status_code=204)
async def delete_password(user: CurrentUser = Depends(require_auth)) -> None:
    _need(user)
    async with get_pool("public").connection() as conn:
        await conn.execute("update mail_link set password = null, updated_by = %s, updated_at = now() where id", (user.email,))
        await conn.commit()


@router.post("/admin/mail/poll")
async def poll_now(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    _need(user)
    return await poll()
