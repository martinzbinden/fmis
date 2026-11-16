"""Meine Links: persönliche Verweise auf der Startseite (schema/0016_user_links.sql).

Jede Person sieht und ändert nur die eigenen (über die E-Mail-Adresse der Anmeldung; «Ansicht als» ändert daran
nichts, die läuft nur im Browser). Nur https-Adressen, damit kein javascript:- oder data:-Link entsteht.
"""

import uuid as uuidlib
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import CurrentUser, require_auth
from .db import get_pool

router = APIRouter()
pool = get_pool("public")
MAX_LINKS = 20


class LinkIn(BaseModel):
    title: str = Field(min_length=1, max_length=60)
    url: str = Field(min_length=8, max_length=500)
    icon: str | None = Field(default=None, max_length=8)


def check_url(url: str) -> str:
    u = url.strip()
    p = urlparse(u)
    if p.scheme != "https" or not p.netloc:
        raise HTTPException(status_code=422, detail="Nur Adressen mit https:// sind erlaubt.")
    return u


@router.get("/core/my-links")
async def list_links(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                "select id, title, url, icon from user_links where lower(owner) = lower(%s) and deleted_at is null order by sort_order, created_at",
                (user.email,),
            )
        ).fetchall()
    return [{"id": str(r[0]), "title": r[1], "url": r[2], "icon": r[3]} for r in rows]


@router.post("/core/my-links")
async def add_link(body: LinkIn, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    url = check_url(body.url)
    async with pool.connection() as conn:
        n = await (await conn.execute("select count(*) from user_links where lower(owner) = lower(%s) and deleted_at is null", (user.email,))).fetchone()
        if n and n[0] >= MAX_LINKS:
            raise HTTPException(status_code=422, detail=f"Höchstens {MAX_LINKS} Links.")
        new_id = str(uuidlib.uuid4())
        await conn.execute(
            "insert into user_links (id, owner, title, url, icon, sort_order) values (%s, %s, %s, %s, %s, %s)",
            (new_id, user.email, body.title.strip(), url, (body.icon or "").strip() or None, int(n[0]) if n else 0),
        )
        await conn.commit()
    return {"id": new_id, "title": body.title.strip(), "url": url, "icon": (body.icon or "").strip() or None}


@router.delete("/core/my-links/{link_id}")
async def delete_link(link_id: str, user: CurrentUser = Depends(require_auth)) -> dict[str, int]:
    try:
        uuidlib.UUID(link_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Unbekannter Link") from exc
    async with pool.connection() as conn:
        res = await conn.execute(
            "update user_links set deleted_at = now() where id = %s and lower(owner) = lower(%s) and deleted_at is null",
            (link_id, user.email),
        )
        await conn.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Unbekannter Link")
    return {"deleted": res.rowcount}
