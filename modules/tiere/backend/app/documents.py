"""Merkblätter und Formulare im Modul Tiere (schema/server/0002_merkblaetter.sql, 0003_merkblaetter_link.sql).

Der Betrieb lädt PDFs (oder Bilder) hoch, z.B. das Merkblatt Nutztiertransporte oder das leere BLV-Formular
«Begleitdokument für Klauentiere», das FMIS dann ausfüllt (dairy: lib/begleitdokument.ts). Fremde Dokumente gehören
nicht ins öffentliche Repo: Sie liegen nur in der Datenbank der Instanz. Nicht synchronisiert; die Liste ist klein und
wird beim Öffnen geholt, der Inhalt erst beim Anzeigen. Body = die Datei selbst (wie machine_files.py, ohne multipart).

Mit Link (url) prüft der Server auf Wunsch, ob unter dem Link inzwischen eine andere Datei liegt (Prüfsumme), und
übernimmt sie als neue Version. Geladen wird nur von öffentlichen Adressen (kein Zugriff ins interne Netz).
"""

import asyncio
import hashlib
import ipaddress
import socket
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, unquote, urlparse
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool

router = APIRouter()
pool = get_pool("tiere")

READ = "tiere:herden:read"
WRITE = "tiere:herden:write"
MAX_BYTES = 30 * 1024 * 1024
ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
TOPICS = {"transport", "allgemein"}
KINDS = {"merkblatt", "formular"}
# Formulare, die FMIS selbst ausfüllt (Erkennung am Feldmuster: tiere/frontend/src/lib/docMeta.ts)
FORM_KEYS = {"begleitdokument_klauentiere", "tierliste_klauentiere"}
COLUMNS = [
    "id", "title", "filename", "content_type", "size_bytes", "source", "topic", "uploaded_at",
    "url", "kind", "form_key", "edition", "checked_at", "check_status", "check_note",
]


def _need(user: CurrentUser, perm: str) -> None:
    if perm not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für Tiergruppen")


def _row(r: Any) -> dict:
    return {k: (str(v) if isinstance(v, UUID) else v) for k, v in zip(COLUMNS, r)}


def _sniff(data: bytes) -> str | None:
    """Dateityp am Inhalt; Server liefern PDFs oft als application/octet-stream."""
    if data.startswith(b"%PDF"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _clean(v: str | None) -> str | None:
    return (v or "").strip() or None


def _check_url(url: str) -> str:
    """Nur http(s) zu öffentlichen Adressen (kein localhost, kein LAN)."""
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise HTTPException(status_code=400, detail="Link muss mit http:// oder https:// beginnen")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except OSError:
        raise HTTPException(status_code=400, detail=f"Adresse {u.hostname} nicht gefunden") from None
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise HTTPException(status_code=400, detail="Nur öffentliche Adressen")
    return url.strip()


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_SafeRedirect)


def _download_sync(url: str) -> tuple[bytes, str, str]:
    req = urllib.request.Request(_check_url(url), headers={"User-Agent": "FMIS (Merkblatt-Abgleich)"})
    try:
        with _opener.open(req, timeout=25) as res:
            data = res.read(MAX_BYTES + 1)
            final = res.geturl()
            disposition = res.headers.get("Content-Disposition") or ""
    except HTTPException:
        raise
    except urllib.error.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Link antwortet mit Fehler {e.code}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise HTTPException(status_code=502, detail=f"Link nicht erreichbar ({getattr(e, 'reason', e)})") from None
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu gross (max. 30 MB)")
    content_type = _sniff(data)
    if not content_type:
        raise HTTPException(status_code=415, detail="Unter dem Link liegt kein PDF oder Bild (z.B. eine Webseite)")
    name = ""
    if "filename=" in disposition:
        name = disposition.split("filename=")[-1].strip().strip('"').split(";")[0]
    if not name:
        name = unquote(urlparse(final).path.rsplit("/", 1)[-1]) or "dokument"
    if "." not in name:
        name += {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[content_type]
    return data, content_type, name[:200]


async def _download(url: str) -> tuple[bytes, str, str]:
    return await asyncio.to_thread(_download_sync, url)


async def _insert(meta: dict, data: bytes, content_type: str, email: str | None) -> UUID:
    digest = hashlib.sha256(data).hexdigest()
    doc_id = uuid4()
    async with pool.connection() as conn:
        dup = await (
            await conn.execute("select title from documents where sha256 = %s and deleted_at is null", (digest,))
        ).fetchone()
        if dup and not meta.get("replaces"):
            raise HTTPException(status_code=409, detail=f"Diese Datei ist schon abgelegt: «{dup[0]}»")
        await conn.execute(
            "insert into documents (id, title, filename, content_type, size_bytes, data, source, topic, uploaded_by, "
            "url, sha256, kind, form_key, edition, checked_at, check_status) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                doc_id, meta["title"], meta["filename"], content_type, len(data), data, meta.get("source"), meta.get("topic"),
                email, meta.get("url"), digest, meta.get("kind") or "merkblatt", meta.get("form_key"), meta.get("edition"),
                datetime.now(timezone.utc) if meta.get("url") else None, "aktuell" if meta.get("url") else None,
            ),
        )
        if meta.get("replaces"):
            await conn.execute(
                "update documents set deleted_at = now(), replaced_by = %s where id = %s and deleted_at is null", (doc_id, meta["replaces"])
            )
        await conn.commit()
    return doc_id


def _validate(meta: dict) -> dict:
    if meta.get("topic") and meta["topic"] not in TOPICS:
        raise HTTPException(status_code=400, detail="Unbekanntes Thema")
    if meta.get("kind") and meta["kind"] not in KINDS:
        raise HTTPException(status_code=400, detail="Unbekannte Art")
    if meta.get("form_key") and meta["form_key"] not in FORM_KEYS:
        raise HTTPException(status_code=400, detail="Unbekanntes Formular")
    if meta.get("url"):
        u = urlparse(meta["url"])
        if u.scheme not in ("http", "https") or not u.hostname:
            raise HTTPException(status_code=400, detail="Link muss mit http:// oder https:// beginnen")
    return meta


@router.get("/documents")
async def list_documents(user: CurrentUser = Depends(require_auth)) -> list[dict]:
    _need(user, READ)
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(f"select {', '.join(COLUMNS)} from documents where deleted_at is null order by kind, topic nulls last, title")
        ).fetchall()
    return [_row(r) for r in rows]


@router.post("/documents")
async def upload_document(
    request: Request,
    filename: str = Query(..., min_length=1, max_length=200),
    title: str = Query(..., min_length=1, max_length=200),
    source: str | None = Query(None, max_length=200),
    topic: str | None = Query(None, max_length=40),
    url: str | None = Query(None, max_length=1000),
    kind: str | None = Query(None, max_length=20),
    form_key: str | None = Query(None, max_length=60),
    edition: str | None = Query(None, max_length=60),
    user: CurrentUser = Depends(require_auth),
) -> dict:
    _need(user, WRITE)
    meta = _validate({"filename": filename, "title": title.strip(), "source": _clean(source), "topic": _clean(topic), "url": _clean(url), "kind": _clean(kind), "form_key": _clean(form_key), "edition": _clean(edition)})
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="Leere Datei")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu gross (max. 30 MB)")
    content_type = _sniff(data) or (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Nur PDF und Bilder (JPEG, PNG, WebP)")
    return {"id": str(await _insert(meta, data, content_type, user.email))}


@router.post("/documents/fetch")
async def fetch_from_url(url: str = Query(..., min_length=8, max_length=1000), user: CurrentUser = Depends(require_auth)) -> Response:
    """Datei hinter einem Link holen (für die Vorschau beim Hochladen; der Browser darf fremde Seiten nicht lesen)."""
    _need(user, WRITE)
    data, content_type, name = await _download(url)
    return Response(content=data, media_type=content_type, headers={"X-Filename": quote(name), "Cache-Control": "no-store"})


@router.patch("/documents/{doc_id}")
async def update_document(doc_id: UUID, body: dict = Body(...), user: CurrentUser = Depends(require_auth)) -> dict:
    _need(user, WRITE)
    allowed = {"title", "source", "topic", "url", "kind", "form_key", "edition"}
    meta = {k: (_clean(v) if isinstance(v, str) or v is None else v) for k, v in body.items() if k in allowed}
    if "title" in meta and not meta["title"]:
        raise HTTPException(status_code=400, detail="Titel fehlt")
    _validate(meta)
    if not meta:
        return {"id": str(doc_id)}
    sets = ", ".join(f"{k} = %s" for k in meta)
    extra = ", checked_at = null, check_status = null, check_note = null" if "url" in meta else ""
    async with pool.connection() as conn:
        cur = await conn.execute(f"update documents set {sets}{extra} where id = %s and deleted_at is null", (*meta.values(), doc_id))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Merkblatt nicht gefunden")
        await conn.commit()
    return {"id": str(doc_id)}


@router.post("/documents/{doc_id}/check")
async def check_document(doc_id: UUID, user: CurrentUser = Depends(require_auth)) -> dict:
    """Liegt unter dem Link noch dieselbe Datei? Vergleicht die Prüfsumme."""
    _need(user, WRITE)
    async with pool.connection() as conn:
        row = await (await conn.execute("select url, sha256 from documents where id = %s and deleted_at is null", (doc_id,))).fetchone()
    if not row or not row[0]:
        raise HTTPException(status_code=404, detail="Kein Link hinterlegt")
    try:
        data, _, _ = await _download(row[0])
        status, note = ("aktuell", None) if hashlib.sha256(data).hexdigest() == row[1] else ("neu", "Unter dem Link liegt eine andere Datei")
    except HTTPException as e:
        status, note = "fehler", str(e.detail)
    async with pool.connection() as conn:
        await conn.execute("update documents set checked_at = now(), check_status = %s, check_note = %s where id = %s", (status, note, doc_id))
        await conn.commit()
    return {"status": status, "note": note}


@router.post("/documents/{doc_id}/update")
async def update_from_url(doc_id: UUID, user: CurrentUser = Depends(require_auth)) -> dict:
    """Neue Version vom Link übernehmen: neue Zeile mit denselben Angaben, die alte bleibt gelöscht stehen."""
    _need(user, WRITE)
    async with pool.connection() as conn:
        row = await (
            await conn.execute("select title, source, topic, url, kind, form_key, edition from documents where id = %s and deleted_at is null", (doc_id,))
        ).fetchone()
    if not row or not row[3]:
        raise HTTPException(status_code=404, detail="Kein Link hinterlegt")
    data, content_type, name = await _download(row[3])
    meta = dict(zip(["title", "source", "topic", "url", "kind", "form_key", "edition"], row))
    meta.update(filename=name, replaces=doc_id)
    return {"id": str(await _insert(meta, data, content_type, user.email))}


@router.get("/documents/{doc_id}")
async def get_document(doc_id: UUID, user: CurrentUser = Depends(require_auth)) -> Response:
    _need(user, READ)
    async with pool.connection() as conn:
        row = await (
            await conn.execute("select content_type, filename, data from documents where id = %s and deleted_at is null", (doc_id,))
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Merkblatt nicht gefunden")
    content_type, filename, data = row
    return Response(
        content=bytes(data),
        media_type=content_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}", "Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(doc_id: UUID, user: CurrentUser = Depends(require_auth)) -> None:
    _need(user, WRITE)
    async with pool.connection() as conn:
        await conn.execute("update documents set deleted_at = now() where id = %s and deleted_at is null", (doc_id,))
        await conn.commit()
