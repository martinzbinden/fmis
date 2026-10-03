"""Bilder und Anleitungen je Maschine (schema/0016_machine_details.sql).

Die Angaben (machine_files) werden normal synchronisiert, der Inhalt liegt
nur serverseitig in machine_file_data (schema/server/0004) — Geräte laden
eine Datei erst, wenn sie angezeigt wird. Hochladen braucht darum eine
Verbindung: der Server schreibt Inhalt, Angaben und data_history in einer
Transaktion, das Gerät holt die neue Zeile mit dem nächsten Pull.

Der Body ist die Datei selbst (Content-Type = Dateityp), keine
multipart-Form — so braucht das Backend keine zusätzliche Abhängigkeit.
"""

from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from .tables import TABLE_AREA

pool = get_pool("wiesenjournal")

router = APIRouter()

MAX_BYTES = 60 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
KINDS = {"bild", "anleitung", "dokument"}

_HISTORY_SQL = """
insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at)
select gen_random_uuid(), 'machine_files', f.id, 'insert', %(email)s, now(), to_jsonb(f)::text, now()
from machine_files f where f.id = %(id)s
"""


def _check(user: CurrentUser, access: str) -> None:
    if f"{TABLE_AREA['machine_files']}:{access}" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für Maschinen")


@router.post("/files/machines/{machine_id}")
async def upload_machine_file(
    machine_id: UUID,
    request: Request,
    filename: str = Query(..., min_length=1, max_length=200),
    kind: str = Query("bild"),
    title: str | None = Query(None, max_length=200),
    source_url: str | None = Query(None, max_length=1000),
    user: CurrentUser = Depends(require_auth),
) -> dict:
    _check(user, "write")
    if kind not in KINDS:
        raise HTTPException(status_code=400, detail="Unbekannte Art")
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Nur Bilder (JPEG, PNG, WebP) und PDF")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="Leere Datei")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu gross (max. 60 MB)")

    file_id = uuid4()
    async with pool.connection() as conn:
        found = await (
            await conn.execute("select 1 from machines where id = %s and deleted_at is null", (machine_id,))
        ).fetchone()
        if not found:
            raise HTTPException(status_code=404, detail="Maschine nicht gefunden")
        await conn.execute("insert into machine_file_data (id, data) values (%s, %s)", (file_id, data))
        row = await (
            await conn.execute(
                """
                insert into machine_files (id, machine_id, kind, title, filename, content_type, size_bytes,
                                           source_url, sort_order, updated_at)
                values (%(id)s, %(machine_id)s, %(kind)s, %(title)s, %(filename)s, %(content_type)s, %(size)s,
                        %(source_url)s,
                        (select coalesce(max(sort_order), 0) + 10 from machine_files where machine_id = %(machine_id)s),
                        now())
                returning id, machine_id, kind, title, filename, content_type, size_bytes, source_url, sort_order
                """,
                {
                    "id": file_id, "machine_id": machine_id, "kind": kind, "title": (title or "").strip() or None,
                    "filename": filename, "content_type": content_type, "size": len(data),
                    "source_url": source_url,
                },
            )
        ).fetchone()
        await conn.execute(_HISTORY_SQL, {"email": user.email, "id": file_id})
        await conn.commit()

    keys = ["id", "machine_id", "kind", "title", "filename", "content_type", "size_bytes", "source_url", "sort_order"]
    return {k: (str(v) if isinstance(v, UUID) else v) for k, v in zip(keys, row)}


@router.get("/files/{file_id}")
async def get_machine_file(file_id: UUID, user: CurrentUser = Depends(require_auth)) -> Response:
    _check(user, "read")
    async with pool.connection() as conn:
        row = await (
            await conn.execute(
                """
                select f.content_type, f.filename, d.data
                from machine_files f join machine_file_data d on d.id = f.id
                where f.id = %s
                """,
                (file_id,),
            )
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    content_type, filename, data = row
    return Response(
        content=bytes(data),
        media_type=content_type,
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}",
            # Inhalt einer id ändert sich nie.
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    )
