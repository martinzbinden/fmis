"""Journal-Parzellen aus den GELAN-Deklarationen des Kulturen-Moduls
(fields.field_declarations) übernehmen — serverseitig, weil beide Schemas in
derselben Postgres-Datenbank liegen und der Server die massgebliche
PostGIS-Geometrie hat (der Client hätte nur dann eine Kopie, wenn das
Kulturen-Modul im selben Browser schon synchronisiert wurde).

Idempotent pro Saison: Schlüssel ist (season_year, fields_lineage_id) — die
lineage_id des Kulturen-Moduls bleibt über die Jahre stabil (GELAN "ID
Kultur"). Bestehende Zeilen werden nur bei tatsächlicher Änderung
aktualisiert; die manuell gepflegten Felder (wiesentyp, intensitaet, notes)
bleiben unangetastet. Import-Regel: nie löschen, nur ergänzen — leere
GELAN-Werte überschreiben nichts (coalesce), und Parzellen, deren
Deklaration es nicht mehr gibt, werden nur gemeldet, nicht gelöscht. Geschrieben wird wie upsertRow() im Client: updated_at
= now() (damit der Pull die Zeilen liefert) plus data_history-Zeile mit
GeoJSON-Text im Snapshot (nicht dem PostGIS-Typ), damit die Verlauf-Seite
alles gleich darstellt.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from .tables import TABLE_AREA

pool = get_pool("wiesenjournal")

router = APIRouter()


class ImportResult(BaseModel):
    year: int
    inserted: int
    updated: int
    unchanged: int
    # Parzellen mit source='fields', deren GELAN-Deklaration im Jahr nicht
    # (mehr) existiert — gemeldet, nicht gelöscht (löschen geht von Hand).
    orphaned: list[str]
    # Immer 0 (Feld bleibt für ältere Clients bestehen).
    deleted: int


# Quelle: eine Zeile je lineage (Hauptkultur zuerst — sequence_in_year 1 vor
# Zwischenfutter), nur echte Flächen (Polygon/MultiPolygon, area > 0) und
# nur Acker-/Futterflächen (5xx/6xx); Bäume/Hecken/Wald/unproduktiv (8xx/9xx)
# und "99999 Bitte Kultur wählen" bleiben draussen. Name = Flurname, sonst
# Kulturname + Fläche, damit die vielen unbenannten GELAN-Polygone
# unterscheidbar bleiben.
_SRC_SQL = """
create temp table src on commit drop as
select distinct on (fd.lineage_id)
       fd.id as fd_id, fd.lineage_id, fd.farm_id, f.name as farm_name, fd.external_kultur_id,
       fd.kultur_code, fd.kultur_name_de,
       coalesce(nullif(trim(fd.flurname), ''),
                coalesce(fd.kultur_name_de, fd.kultur_code) || ' ' || round(fd.area_a) || ' a') as name,
       fd.area_a, fd.geometry,
       case when fd.kultur_code ~ '^5[0-9][0-9]$' then 'acker'
            when fd.kultur_code ~ '^6[0-9][0-9]$' then 'futter' else 'andere' end as category
from fields.field_declarations fd
join fields.farms f on f.id = fd.farm_id
where fd.jahr = %(year)s and fd.deleted_at is null
  and fd.geometry is not null and GeometryType(fd.geometry) in ('POLYGON', 'MULTIPOLYGON')
  and coalesce(fd.area_a, 0) > 0
  and fd.kultur_code ~ %(code_regex)s
order by fd.lineage_id, fd.sequence_in_year
"""

_UPDATE_SQL = """
update parcels p set
  name = s.name, area_a = coalesce(s.area_a, p.area_a), base_geometry = coalesce(s.geometry, p.base_geometry),
  farm_id = coalesce(s.farm_id, p.farm_id), farm_name = coalesce(s.farm_name, p.farm_name),
  fields_declaration_id = coalesce(s.fd_id, p.fields_declaration_id),
  external_kultur_id = coalesce(s.external_kultur_id, p.external_kultur_id),
  kultur_code = coalesce(s.kultur_code, p.kultur_code), kultur_name_de = coalesce(s.kultur_name_de, p.kultur_name_de),
  category = s.category, source = 'fields', updated_at = now()
from src s
where p.season_year = %(year)s and p.deleted_at is null and p.fields_lineage_id = s.lineage_id
  and (
    (p.name, p.area_a, p.kultur_code, p.kultur_name_de, p.category, p.farm_id, p.farm_name,
     p.fields_declaration_id, p.external_kultur_id)
      is distinct from
    (s.name, coalesce(s.area_a, p.area_a), coalesce(s.kultur_code, p.kultur_code),
     coalesce(s.kultur_name_de, p.kultur_name_de), s.category, coalesce(s.farm_id, p.farm_id),
     coalesce(s.farm_name, p.farm_name), coalesce(s.fd_id, p.fields_declaration_id),
     coalesce(s.external_kultur_id, p.external_kultur_id))
    or p.base_geometry is null or not ST_Equals(p.base_geometry, s.geometry)
  )
returning p.id
"""

_INSERT_SQL = """
insert into parcels (id, season_year, name, area_a, wiesentyp, intensitaet, base_geometry,
                     sort_order, notes, updated_at, deleted_at, source, category, farm_id, farm_name,
                     fields_lineage_id, fields_declaration_id, external_kultur_id, kultur_code, kultur_name_de)
select gen_random_uuid(), %(year)s, s.name, s.area_a, null, null, s.geometry,
       1000 + row_number() over (order by s.farm_name, s.category, s.name), null, now(), null,
       'fields', s.category, s.farm_id, s.farm_name,
       s.lineage_id, s.fd_id, s.external_kultur_id, s.kultur_code, s.kultur_name_de
from src s
where not exists (
  select 1 from parcels p
  where p.season_year = %(year)s and p.deleted_at is null and p.fields_lineage_id = s.lineage_id
)
returning id
"""

_UNCHANGED_SQL = """
select count(*) from parcels p join src s on s.lineage_id = p.fields_lineage_id
where p.season_year = %(year)s and p.deleted_at is null
"""

# Verwaiste GELAN-Parzellen: source='fields', aber im Jahr keine Quelle mehr
# (Deklaration gelöscht/umkategorisiert) — nur melden.
_ORPHANS_SQL = """
select p.name
from parcels p
where p.season_year = %(year)s and p.deleted_at is null and p.source = 'fields'
  and p.fields_lineage_id is not null
  and not exists (select 1 from src s where s.lineage_id = p.fields_lineage_id)
"""

_HISTORY_SQL = """
insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at)
select gen_random_uuid(), 'parcels', p.id, %(action)s, %(email)s, now(),
       (to_jsonb(p) - 'base_geometry' || jsonb_build_object('base_geometry', ST_AsGeoJSON(p.base_geometry)))::text,
       now()
from parcels p where p.id = any(%(ids)s::uuid[])
"""


@router.post("/parcels/import-from-fields", response_model=ImportResult)
async def import_from_fields(
    year: int,
    include_andere: bool = False,
    user: CurrentUser = Depends(require_auth),
) -> ImportResult:
    area = TABLE_AREA["parcels"]
    if f"{area}:write" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Schreibrechte für Parzellen")

    code_regex = "^[567][0-9][0-9]$" if include_andere else "^[56][0-9][0-9]$"
    async with pool.connection() as conn:
        await conn.execute(_SRC_SQL, {"year": year, "code_regex": code_regex})
        updated_ids = [r[0] for r in await (await conn.execute(_UPDATE_SQL, {"year": year})).fetchall()]
        inserted_ids = [r[0] for r in await (await conn.execute(_INSERT_SQL, {"year": year})).fetchall()]
        unchanged = (await (await conn.execute(_UNCHANGED_SQL, {"year": year})).fetchone())[0]
        unchanged -= len(updated_ids) + len(inserted_ids)

        orphan_names = [r[0] for r in await (await conn.execute(_ORPHANS_SQL, {"year": year})).fetchall()]

        for action, ids in (("insert", inserted_ids), ("update", updated_ids)):
            if ids:
                await conn.execute(_HISTORY_SQL, {"action": action, "email": user.email, "ids": ids})
        await conn.commit()

    return ImportResult(
        year=year,
        inserted=len(inserted_ids),
        updated=len(updated_ids),
        unchanged=max(unchanged, 0),
        orphaned=orphan_names,
        deleted=0,
    )
