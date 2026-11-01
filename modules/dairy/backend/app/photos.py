"""Fotos zu Journal-Einträgen (schema/0023_journal_photos.sql).

Die Angaben (journal_photos) legt das Gerät selbst an und synchronisiert sie
normal; den Inhalt lädt es separat hoch, sobald es Verbindung hat — auch
später, wenn das Foto im Stall ohne Empfang gemacht wurde. Darum nimmt PUT
den Inhalt auch an, bevor die Zeile per Sync angekommen ist. Eine id behält
ihren Inhalt für immer (ein zweites PUT ändert nichts), so ist das Hochladen
beliebig oft wiederholbar.

Der Body ist die Datei selbst (Content-Type = Bildtyp), keine multipart-Form —
wie bei den Maschinen-Dateien (modules/betrieb/backend/app/machine_files.py).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool

from .tables import table_area

MAX_BYTES = 15 * 1024 * 1024
ALLOWED_TYPES = {"image/webp", "image/jpeg", "image/png"}


def build_photo_router(key: str) -> APIRouter:
    pool = get_pool(key)
    area = table_area(key)["journal_photos"]
    router = APIRouter()

    def check(user: CurrentUser, access: str) -> None:
        if f"{area}:{access}" not in user.permissions:
            raise HTTPException(status_code=403, detail="Keine Berechtigung für Tierdaten")

    @router.put("/photos/{photo_id}", status_code=204)
    async def upload_photo(photo_id: UUID, request: Request, user: CurrentUser = Depends(require_auth)) -> Response:
        check(user, "write")
        content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=415, detail="Nur Fotos (WebP, JPEG, PNG)")
        data = await request.body()
        if not data:
            raise HTTPException(status_code=400, detail="Leeres Foto")
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Foto zu gross (max. 15 MB)")
        async with pool.connection() as conn:
            await conn.execute(
                """insert into journal_photo_data (id, data, content_type, created_by)
                   values (%s, %s, %s, %s) on conflict (id) do nothing""",
                (photo_id, data, content_type, user.email),
            )
            await conn.commit()
        return Response(status_code=204)

    @router.get("/photos/{photo_id}")
    async def get_photo(photo_id: UUID, user: CurrentUser = Depends(require_auth)) -> Response:
        check(user, "read")
        async with pool.connection() as conn:
            row = await (
                await conn.execute("select content_type, data from journal_photo_data where id = %s", (photo_id,))
            ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Foto noch nicht hochgeladen")
        content_type, data = row
        # Inhalt einer id ändert sich nie.
        return Response(content=bytes(data), media_type=content_type, headers={"Cache-Control": "private, max-age=31536000, immutable"})

    return router
