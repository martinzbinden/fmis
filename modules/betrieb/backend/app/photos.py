"""Fotos zu Arbeiten und Betriebsjournal (schema/0015_photos.sql), Inhalt als Dateien
(core/backend/fmis_core/photo_files.py).

Die Angaben (photos) legt das Gerät an und synchronisiert sie normal; Foto und Vorschau lädt es separat hoch, sobald
es Verbindung hat. PUT nimmt den Inhalt auch an, bevor die Zeile per Sync angekommen ist. ?thumb=1 = Vorschau.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from core.backend.fmis_core import photo_files
from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool

from .tables import TABLE_AREA

MODULE = "betrieb"
AREA = TABLE_AREA["photos"]
router = APIRouter()


def _check(user: CurrentUser, access: str) -> None:
    if f"{AREA}:{access}" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für Fotos")


@router.put("/photos/{photo_id}", status_code=204)
async def upload_photo(photo_id: UUID, request: Request, thumb: bool = False, user: CurrentUser = Depends(require_auth)) -> Response:
    _check(user, "write")
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in photo_files.EXT:
        raise HTTPException(status_code=415, detail="Nur Fotos (WebP, JPEG, PNG)")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="Leeres Foto")
    if len(data) > (photo_files.MAX_THUMB_BYTES if thumb else photo_files.MAX_BYTES):
        raise HTTPException(status_code=413, detail="Foto zu gross")
    photo_files.save(MODULE, str(photo_id), data, content_type, thumb)
    return Response(status_code=204)


@router.get("/photos/{photo_id}")
async def get_photo(photo_id: UUID, thumb: bool = False, user: CurrentUser = Depends(require_auth)) -> Response:
    _check(user, "read")
    hit = photo_files.find(MODULE, str(photo_id), thumb) or (photo_files.find(MODULE, str(photo_id)) if thumb else None)
    if not hit:
        # Angaben vorhanden, Datei weg = archiviert; sonst noch nicht hochgeladen
        async with get_pool(MODULE).connection() as conn:
            row = await (await conn.execute("select archived_at from photos where id = %s and deleted_at is null", (photo_id,))).fetchone()
        if row and row[0] is not None:
            raise HTTPException(status_code=410, detail="Foto archiviert")
        raise HTTPException(status_code=404, detail="Foto noch nicht hochgeladen")
    path, content_type = hit
    return Response(content=path.read_bytes(), media_type=content_type, headers={"Cache-Control": "private, max-age=31536000, immutable"})
