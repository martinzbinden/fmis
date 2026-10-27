"""Grundlagen für die Karte der Bauprojekte, z.B. die Ebenen eines Leitungskataster-Auszugs.

Hochladen: ein ZIP aus tools/leitungskataster_pdf.py (manifest.json + je Ebene ein PNG in
der Kartenprojektion). Der Server legt alle Ebenen in einer Transaktion an: Angaben in
overlays (synchronisiert, schema/0003), Bild in overlay_data (nur Server, schema/server/0002),
dazu data_history. Geräte laden die Bilder bei Bedarf und behalten sie im Browser-Cache.

Liegt unter /sync/, damit die bestehende Traefik-Regel (`/bau/sync`) die Pfade abdeckt.
Der Body ist das ZIP selbst (keine multipart-Form, siehe betrieb/backend/app/machine_files.py).
"""

import io
import json
import zipfile
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from .tables import TABLE_AREA

pool = get_pool("bau")
router = APIRouter()

MAX_BYTES = 40 * 1024 * 1024
MAX_LAYERS = 30
PNG = b"\x89PNG\r\n\x1a\n"

_HISTORY_SQL = """
insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at)
select gen_random_uuid(), 'overlays', o.id, 'insert', %(email)s, now(), to_jsonb(o)::text, now()
from overlays o where o.id = %(id)s
"""


def _check(user: CurrentUser, access: str) -> None:
    if f"{TABLE_AREA['overlays']}:{access}" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Berechtigung für Bauprojekte")


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def _bounds(v: object) -> tuple[float, float, float, float]:
    if not isinstance(v, list) or len(v) != 4 or not all(isinstance(x, (int, float)) for x in v):
        raise _bad("Ebene ohne gültige Ausdehnung")
    s, w, n, e = (float(x) for x in v)
    if not (-90 <= s < n <= 90 and -180 <= w < e <= 180):
        raise _bad("Ebene ohne gültige Ausdehnung")
    return s, w, n, e


@router.post("/sync/overlays")
async def upload_overlays(request: Request, user: CurrentUser = Depends(require_auth)) -> dict:
    _check(user, "write")
    data = await request.body()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu gross (max. 40 MB)")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        manifest = json.loads(z.read("manifest.json"))
    except (zipfile.BadZipFile, KeyError, ValueError):
        raise _bad("Kein Grundlagen-ZIP (manifest.json fehlt). Erstellt mit tools/leitungskataster_pdf.py.")
    if manifest.get("fmis_grundlage") != 1 or not isinstance(manifest.get("layers"), list):
        raise _bad("Unbekanntes Grundlagen-Format")
    layers = manifest["layers"]
    if not 0 < len(layers) <= MAX_LAYERS:
        raise _bad("Keine oder zu viele Ebenen")
    group = str(manifest.get("group") or "Grundlage")[:200]
    kind = str(manifest.get("kind") or "leitungskataster")[:40]
    source = str(manifest.get("source") or "")[:500] or None

    rows = []
    for i, la in enumerate(layers):
        if not isinstance(la, dict):
            raise _bad("Ungültige Ebene")
        try:
            png = z.read(str(la.get("file")))
        except KeyError:
            raise _bad(f"Bild {la.get('file')} fehlt im ZIP")
        if not png.startswith(PNG):
            raise _bad(f"{la.get('file')} ist kein PNG")
        color = la.get("color")
        rows.append({
            "id": str(uuid4()),
            "name": str(la.get("name") or f"Ebene {i + 1}")[:200],
            "color": color if isinstance(color, str) and len(color) <= 9 else None,
            "bounds": _bounds(la.get("bounds")),
            "opacity": min(1.0, max(0.1, float(la.get("opacity", 1)))),
            "visible": bool(la.get("visible", True)),
            "png": png,
        })

    group_id = str(uuid4())
    async with pool.connection() as conn:  # alles oder nichts: ohne commit verwirft der Pool die Transaktion
        for i, r in enumerate(rows):
            s, w, n, e = r["bounds"]
            await conn.execute(
                "insert into overlay_data (id, content_type, data) values (%s, 'image/png', %s)",
                (r["id"], r["png"]),
            )
            await conn.execute(
                "insert into overlays (id, group_id, group_name, kind, name, color, south, west, north, east, "
                "opacity, visible, sort_order, source, size_bytes, created_by) "
                "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (r["id"], group_id, group, kind, r["name"], r["color"], s, w, n, e, r["opacity"], r["visible"], i, source, len(r["png"]), user.email),
            )
            await conn.execute(_HISTORY_SQL, {"email": user.email, "id": r["id"]})
        await conn.commit()
    return {"group_id": group_id, "layers": len(rows)}


@router.get("/sync/overlays/{overlay_id}")
async def overlay_image(overlay_id: UUID, user: CurrentUser = Depends(require_auth)) -> Response:
    _check(user, "read")
    async with pool.connection() as conn:
        row = await (await conn.execute("select content_type, data from overlay_data where id = %s", (overlay_id,))).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Bild nicht gefunden")
    # Bilder ändern sich nie (neue Grundlage = neue id)
    return Response(content=bytes(row[1]), media_type=row[0], headers={"Cache-Control": "private, max-age=31536000, immutable"})
