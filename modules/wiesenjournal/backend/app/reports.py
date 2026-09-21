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

from fastapi import APIRouter, Depends, HTTPException, Response
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


# ---------------------------------------------------------------------------
# Nährstoff-Auswertung je Journal-(GELAN-)Parzelle
# ---------------------------------------------------------------------------


class ParcelNutrients(BaseModel):
    parcel_id: str
    name: str
    farm_name: str | None
    category: str
    kultur_name_de: str | None
    area_a: float | None
    applications: int
    n_kg: float
    n_avail_kg: float
    p2o5_kg: float
    k2o_kg: float
    n_kg_per_ha: float | None
    n_avail_kg_per_ha: float | None


class NutrientTotals(BaseModel):
    key: str
    area_a: float
    n_kg: float
    n_avail_kg: float
    p2o5_kg: float
    k2o_kg: float
    n_kg_per_ha: float | None


class NutrientReport(BaseModel):
    year: int
    parcels: list[ParcelNutrients]
    totals_by_farm: list[NutrientTotals]
    totals_by_category: list[NutrientTotals]


@router.get("/reports/nutrients", response_model=NutrientReport)
async def nutrients(year: int, user: CurrentUser = Depends(require_auth)) -> NutrientReport:
    """Summe der Massnahmen-Anteile je Parzelle der Saison (aus
    fertilization_shares, siehe backend/app/fertilization.py) — dieselben
    Zahlen wie das Gaben-Panel im Client, hier für alle Parzellen auf einmal
    plus Totale je Betrieb/Kategorie und CSV-Export."""
    area = TABLE_AREA["fertilization_entries"]
    if f"{area}:read" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Leserechte für Düngung")
    sql = """
        select p.id, p.name, p.farm_name, p.category, p.kultur_name_de, p.area_a,
               count(distinct s.entry_id) as applications,
               coalesce(sum(s.n_kg), 0), coalesce(sum(s.n_avail_kg), 0),
               coalesce(sum(s.p2o5_kg), 0), coalesce(sum(s.k2o_kg), 0)
        from parcels p
        left join fertilization_shares s on s.parcel_id = p.id and s.deleted_at is null
        left join fertilization_entries e on e.id = s.entry_id and e.deleted_at is null
             and extract(year from e.entry_date) = %(year)s
        where p.season_year = %(year)s and p.deleted_at is null
        group by p.id
        order by p.farm_name nulls last, p.category, p.name
    """
    async with pool.connection() as conn:
        rows = await (await conn.execute(sql, {"year": year})).fetchall()

    def per_ha(kg: float, area_a: float | None) -> float | None:
        return round(kg / area_a * 100, 1) if area_a and area_a > 0 else None

    parcels: list[ParcelNutrients] = []
    for pid, name, farm_name, category, kultur, area_a, applications, n, n_av, p, k in rows:
        area_f = float(area_a) if area_a is not None else None
        # applications zählt auch Anteile von Massnahmen anderer Jahre nicht mit —
        # der Join auf e filtert, aber s bleibt (left join): nur zählen, wo e passt.
        parcels.append(ParcelNutrients(
            parcel_id=str(pid), name=name, farm_name=farm_name, category=category, kultur_name_de=kultur,
            area_a=area_f, applications=int(applications),
            n_kg=round(float(n), 1), n_avail_kg=round(float(n_av), 1), p2o5_kg=round(float(p), 1), k2o_kg=round(float(k), 1),
            n_kg_per_ha=per_ha(float(n), area_f), n_avail_kg_per_ha=per_ha(float(n_av), area_f),
        ))

    def totals(keyfn) -> list[NutrientTotals]:
        acc: dict[str, dict[str, float]] = {}
        for pr in parcels:
            key = keyfn(pr) or "–"
            t = acc.setdefault(key, {"area_a": 0, "n_kg": 0, "n_avail_kg": 0, "p2o5_kg": 0, "k2o_kg": 0})
            t["area_a"] += pr.area_a or 0
            t["n_kg"] += pr.n_kg
            t["n_avail_kg"] += pr.n_avail_kg
            t["p2o5_kg"] += pr.p2o5_kg
            t["k2o_kg"] += pr.k2o_kg
        return [
            NutrientTotals(key=k, area_a=round(t["area_a"], 1), n_kg=round(t["n_kg"], 1), n_avail_kg=round(t["n_avail_kg"], 1),
                           p2o5_kg=round(t["p2o5_kg"], 1), k2o_kg=round(t["k2o_kg"], 1), n_kg_per_ha=per_ha(t["n_kg"], t["area_a"]))
            for k, t in sorted(acc.items())
        ]

    return NutrientReport(
        year=year, parcels=parcels,
        totals_by_farm=totals(lambda pr: pr.farm_name),
        totals_by_category=totals(lambda pr: pr.category),
    )


# ---------------------------------------------------------------------------
# Düngungskarte: planarer Verschnitt aller Massnahmen-Flächen
# ---------------------------------------------------------------------------

_FERT_MAP_SQL = """
with ent as (
  -- Geometrie je Massnahme: eigene Fläche (polygon/track) oder die gedüngten
  -- Parzellen über die Anteile; alles in LV95 (Meter)
  select e.id, e.n_kg, e.n_avail_kg, e.area_a,
         ST_Transform(coalesce(e.geometry, ST_Union(p.base_geometry)), 2056) as geom
  from fertilization_entries e
  left join fertilization_shares s on s.entry_id = e.id and s.deleted_at is null
  left join parcels p on p.id = s.parcel_id
  where e.deleted_at is null and extract(year from e.entry_date) = %(year)s
    and e.n_kg is not null and coalesce(e.area_a, 0) > 0
  group by e.id, e.n_kg, e.n_avail_kg, e.area_a, e.geometry
),
ent_ok as (select * from ent where geom is not null),
noded as (
  -- Kanten aller Flächen knoten (ein MultiLineString) ...
  select ST_Node(ST_Collect(ST_Boundary(geom))) as g from ent_ok
),
faces as (
  -- ... und zu Flächenstücken zusammensetzen: jedes Stück liegt in genau
  -- derselben Menge von Massnahmen
  select (ST_Dump(ST_Polygonize(g))).geom as face from noded
),
scored as (
  select f.face, count(*) as cnt,
         sum(a.n_kg / a.area_a * 100) as n_kg_per_ha,
         sum(a.n_avail_kg / a.area_a * 100) as n_avail_kg_per_ha
  from faces f
  join ent_ok a on ST_Contains(a.geom, ST_PointOnSurface(f.face))
  where ST_Area(f.face) >= 5
  group by f.face
)
select json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(
  json_build_object('type', 'Feature',
    'geometry', ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(face, 0.5), 4326))::json,
    'properties', json_build_object('n_kg_per_ha', round(n_kg_per_ha::numeric, 1),
                                    'n_avail_kg_per_ha', round(n_avail_kg_per_ha::numeric, 1),
                                    'count', cnt, 'area_a', round((ST_Area(face) / 100)::numeric, 2)))), '[]'::json))::text
from scored
"""


@router.get("/reports/fertilization-map")
async def fertilization_map(year: int, user: CurrentUser = Depends(require_auth)) -> Response:
    """GeoJSON-FeatureCollection des Verschnitts aller Düngungsmassnahmen des
    Jahres — unabhängig von Parzellengrenzen: jede Teilfläche trägt die
    Summe der kg N/ha aller Massnahmen, die sie überdecken."""
    area = TABLE_AREA["fertilization_entries"]
    if f"{area}:read" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Leserechte für Düngung")
    async with pool.connection() as conn:
        row = await (await conn.execute(_FERT_MAP_SQL, {"year": year})).fetchone()
    return Response(content=row[0], media_type="application/geo+json")
