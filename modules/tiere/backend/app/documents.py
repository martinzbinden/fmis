"""Merkblätter im Modul Tiere (schema/server/0002_merkblaetter.sql).

Der Betrieb lädt PDFs (oder Bilder) hoch, z.B. das Merkblatt Nutztiertransporte. Fremde Dokumente gehören nicht ins
öffentliche Repo: Sie liegen nur in der Datenbank der Instanz. Nicht synchronisiert; die Liste ist klein und wird
beim Öffnen geholt, der Inhalt erst beim Anzeigen. Body = die Datei selbst (wie machine_files.py, ohne multipart).
"""

from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool

router = APIRouter()
pool = get_pool("tiere")

READ = "tiere:herden:read"
WRITE = "tiere:herden:write"
MAX_BYTES = 30 * 1024 * 1024
ALLOWED_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
TOPICS = {"transport", "allgemein"}


def _need(user: CurrentUser, perm: str) -> None:
    if perm not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für Tiergruppen")


@router.get("/documents")
async def list_documents(user: CurrentUser = Depends(require_auth)) -> list[dict]:
    _need(user, READ)
    async with pool.connection() as conn:
        rows = await (
            await conn.execute(
                "select id, title, filename, content_type, size_bytes, source, topic, uploaded_at from documents "
                "where deleted_at is null order by topic nulls last, title"
            )
        ).fetchall()
    keys = ["id", "title", "filename", "content_type", "size_bytes", "source", "topic", "uploaded_at"]
    return [{k: (str(v) if isinstance(v, UUID) else v) for k, v in zip(keys, r)} for r in rows]


@router.post("/documents")
async def upload_document(
    request: Request,
    filename: str = Query(..., min_length=1, max_length=200),
    title: str = Query(..., min_length=1, max_length=200),
    source: str | None = Query(None, max_length=200),
    topic: str | None = Query(None, max_length=40),
    user: CurrentUser = Depends(require_auth),
) -> dict:
    _need(user, WRITE)
    if topic and topic not in TOPICS:
        raise HTTPException(status_code=400, detail="Unbekanntes Thema")
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Nur PDF und Bilder (JPEG, PNG, WebP)")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="Leere Datei")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu gross (max. 30 MB)")
    doc_id = uuid4()
    async with pool.connection() as conn:
        await conn.execute(
            "insert into documents (id, title, filename, content_type, size_bytes, data, source, topic, uploaded_by) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (doc_id, title.strip(), filename, content_type, len(data), data, (source or "").strip() or None, topic or None, user.email),
        )
        await conn.commit()
    return {"id": str(doc_id)}


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
