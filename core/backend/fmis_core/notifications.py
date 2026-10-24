"""Benachrichtigungen: Glocke in der Kopfzeile (ungelesene zählen) und E-Mail,
sofern die Person sie im Profil nicht ausgeschaltet hat (Standard: ein).

Module erzeugen Meldungen serverseitig mit `notify()` in derselben Transaktion
wie die auslösende Änderung (z.B. betrieb/sync.py beim Abtausch). Die E-Mail
geht erst nach dem Commit raus: `notify` plant den Versand, der Versand prüft,
ob die Meldung tatsächlich gespeichert wurde.
"""

import asyncio
import logging
import os
import uuid as uuidlib
from email.message import EmailMessage
from typing import Any, Iterable

import aiosmtplib
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import email as mail
from .auth import CurrentUser, require_auth
from .db import get_pool

log = logging.getLogger(__name__)
router = APIRouter()
pool = get_pool("public")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")


async def notify(conn: Any, recipients: Iterable[str | None], kind: str, title: str, body: str | None = None, link: str | None = None, actor: str | None = None) -> None:
    """Meldung für jede Adresse (ohne die auslösende Person, ohne Doppel). `conn` = laufende Transaktion."""
    seen: set[str] = set()
    ids: list[str] = []
    for r in recipients:
        email = (r or "").strip().lower()
        if not email or email in seen or (actor and email == actor.strip().lower()):
            continue
        seen.add(email)
        nid = str(uuidlib.uuid4())
        await conn.execute(
            "insert into public.notifications (id, recipient, kind, title, body, link) values (%s, %s, %s, %s, %s, %s)",
            (nid, email, kind, title, body, link),
        )
        ids.append(nid)
    if ids:
        asyncio.get_running_loop().create_task(_email_later(ids))


async def office_emails(conn: Any, permission: str) -> list[str]:
    """Aktive Konten mit diesem Recht (z.B. das Büro mit betrieb:dienste:write)."""
    rows = await (
        await conn.execute(
            "select u.email from public.users u join public.roles r on r.id = u.role_id where u.status = 'active' and %s = any(r.permissions)",
            (permission,),
        )
    ).fetchall()
    return [r[0] for r in rows]


async def _email_later(ids: list[str]) -> None:
    """Nach dem Commit der auslösenden Transaktion: E-Mail an alle, die das wollen."""
    await asyncio.sleep(2)
    try:
        async with pool.connection() as conn:
            rows = await (
                await conn.execute(
                    """
                    select n.id, n.recipient, n.title, n.body, n.link
                    from notifications n left join users u on lower(u.email) = lower(n.recipient)
                    where n.id = any(%s::uuid[]) and n.emailed_at is null and coalesce(u.notify_email, true)
                    """,
                    (ids,),
                )
            ).fetchall()
            for nid, to, title, body, link in rows:
                try:
                    await _send(to, title, body, link)
                    await conn.execute("update notifications set emailed_at = now() where id = %s", (nid,))
                except Exception:  # Versand darf nie die App stören
                    log.exception("Benachrichtigung per E-Mail an %s fehlgeschlagen", to)
            await conn.commit()
    except Exception:
        log.exception("E-Mail-Versand der Benachrichtigungen fehlgeschlagen")


async def _send(to: str, title: str, body: str | None, link: str | None) -> None:
    message = EmailMessage()
    message["From"] = mail.SMTP_FROM
    message["To"] = to
    message["Subject"] = f"FMIS: {title}"
    url = f"{PUBLIC_URL}{link}" if link and PUBLIC_URL else (link or "")
    message.set_content(
        f"{title}\n\n{body or ''}\n\n{('Ansehen: ' + url) if url else ''}\n\n"
        "Diese E-Mail kannst du in FMIS unter der Glocke (oben) ausschalten."
    )
    await aiosmtplib.send(message, hostname=mail.SMTP_HOST, port=mail.SMTP_PORT, username=mail.SMTP_USER, password=mail.SMTP_PASSWORD, start_tls=mail.SMTP_USE_TLS)


class NotificationOut(BaseModel):
    id: str
    kind: str
    title: str
    body: str | None
    link: str | None
    created_at: str
    read: bool


class NotificationList(BaseModel):
    unread: int
    items: list[NotificationOut]
    notify_email: bool


@router.get("/core/notifications", response_model=NotificationList)
async def list_notifications(user: CurrentUser = Depends(require_auth)) -> NotificationList:
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                "select id, kind, title, body, link, created_at, read_at from notifications where lower(recipient) = lower(%s) order by created_at desc limit 50",
                (user.email,),
            )
        ).fetchall()
        unread = (await (await conn.execute("select count(*) from notifications where lower(recipient) = lower(%s) and read_at is null", (user.email,))).fetchone())[0]
        pref = await (await conn.execute("select notify_email from users where lower(email) = lower(%s)", (user.email,))).fetchone()
    return NotificationList(
        unread=unread,
        items=[NotificationOut(id=str(r[0]), kind=r[1], title=r[2], body=r[3], link=r[4], created_at=r[5].isoformat(), read=r[6] is not None) for r in rows],
        notify_email=bool(pref[0]) if pref else True,
    )


class ReadBody(BaseModel):
    ids: list[str] = []
    all: bool = False


@router.post("/core/notifications/read")
async def mark_read(body: ReadBody, user: CurrentUser = Depends(require_auth)) -> dict[str, int]:
    async with pool.connection() as conn:
        if body.all:
            res = await conn.execute("update notifications set read_at = now() where lower(recipient) = lower(%s) and read_at is null", (user.email,))
        else:
            res = await conn.execute(
                "update notifications set read_at = now() where lower(recipient) = lower(%s) and read_at is null and id = any(%s::uuid[])",
                (user.email, body.ids),
            )
        await conn.commit()
    return {"updated": res.rowcount}


class ProfileBody(BaseModel):
    notify_email: bool


@router.put("/core/profile/notifications")
async def set_profile(body: ProfileBody, user: CurrentUser = Depends(require_auth)) -> dict[str, bool]:
    async with pool.connection() as conn:
        await conn.execute("update users set notify_email = %s where lower(email) = lower(%s)", (body.notify_email, user.email))
        await conn.commit()
    return {"notify_email": body.notify_email}
