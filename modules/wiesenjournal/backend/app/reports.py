"""Jahresauswertung: verschneidet Wiesenjournal-Weidegänge mit den
GELAN-deklarierten Parzellen aus dem Kulturen-Modul (fields), um pro
Parzelle zu zeigen, welche Weidegänge sie wie stark überlappen — die
Grundlage für eine Ertragsaussage am Jahresende. Zäune/Weidegänge müssen
sich dafür NICHT an die Parzellengrenzen halten (siehe README, "Variante 1")
— die Überlappung wird berechnet statt referenziert.

Server-seitige PostGIS-Abfrage über zwei Modul-Schemas hinweg (fields +
wiesenjournal liegen in derselben physischen Postgres-Datenbank, siehe
core/backend/fmis_core/db.py) — dem Client (pglite) bleibt das verborgen,
dieser Endpunkt läuft NICHT über den generischen Sync-Mechanismus.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from .tables import TABLE_AREA

pool = get_pool("wiesenjournal")

router = APIRouter()


class Overlap(BaseModel):
    paddock_id: str
    animal_group: str | None
    valid_from: str
    valid_to: str | None
    overlap_a: float
    overlap_pct: float | None


class ParcelOverlap(BaseModel):
    field_declaration_id: str
    flurname: str | None
    kultur_name_de: str | None
    area_a: float | None
    overlaps: list[Overlap]


class ParcelOverlapReport(BaseModel):
    year: int
    parcels: list[ParcelOverlap]


@router.get("/reports/parcel-overlap", response_model=ParcelOverlapReport)
async def parcel_overlap(year: int, user: CurrentUser = Depends(require_auth)) -> ParcelOverlapReport:
    area = TABLE_AREA["paddocks"]
    if f"{area}:read" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Leserechte für Weidegänge")

    # fields.field_declarations ist schema-qualifiziert direkt abfragbar —
    # derselbe Postgres-Benutzer, dieselbe Datenbank, keine zusätzlichen
    # Rechte nötig (siehe core/backend/fmis_core/db.py: jeder Modul-Pool hat
    # 'public' im search_path, aber Schema-Qualifizierung funktioniert
    # unabhängig davon für JEDES Schema in derselben Datenbank).
    sql = """
        select fd.id, fd.flurname, fd.kultur_name_de, fd.area_a,
               wp.paddock_id, wp.animal_group, wp.valid_from, wp.valid_to,
               ST_Area(ST_Intersection(fd.geometry, wp.geometry)::geography) / 100 as overlap_a
        from fields.field_declarations fd
        join wiesenjournal.paddocks wp
          on ST_Intersects(fd.geometry, wp.geometry)
        where fd.deleted_at is null and fd.jahr = %(year)s and fd.geometry is not null
          and wp.deleted_at is null and wp.is_current and wp.season_year = %(year)s
        order by fd.flurname, wp.valid_from
    """
    async with pool.connection() as conn:
        rows = await (await conn.execute(sql, {"year": year})).fetchall()

    parcels: dict[str, ParcelOverlap] = {}
    for row in rows:
        (
            fd_id, flurname, kultur_name_de, area_a,
            paddock_id, animal_group, valid_from, valid_to, overlap_a,
        ) = row
        parcel = parcels.get(fd_id)
        if parcel is None:
            parcel = ParcelOverlap(
                field_declaration_id=str(fd_id),
                flurname=flurname,
                kultur_name_de=kultur_name_de,
                area_a=float(area_a) if area_a is not None else None,
                overlaps=[],
            )
            parcels[fd_id] = parcel
        overlap_a_val = float(overlap_a) if overlap_a is not None else 0.0
        parcel.overlaps.append(
            Overlap(
                paddock_id=str(paddock_id),
                animal_group=animal_group,
                valid_from=valid_from.isoformat(),
                valid_to=valid_to.isoformat() if valid_to else None,
                overlap_a=round(overlap_a_val, 2),
                overlap_pct=round(overlap_a_val / float(area_a) * 100, 1)
                if area_a and float(area_a) > 0
                else None,
            )
        )

    return ParcelOverlapReport(year=year, parcels=list(parcels.values()))
