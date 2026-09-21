"""Flächenbezug von Düngungsmassnahmen — serverseitig mit PostGIS.

- POST /fertilization/resolve-extent: reine Berechnung (kein Schreiben).
  Liefert für ein frei gezeichnetes Polygon, einen gepufferten GPS-Track
  oder mehrere Parzellen die Gesamtgeometrie, die Fläche und die Anteile je
  Journal-Parzelle (Verschneidung mit parcels.base_geometry). Der Client
  schreibt Massnahme + Anteile danach selbst über den normalen Sync
  (upsertRow), damit Outbox/Verlauf wie bei jeder anderen Schreibung laufen.
  Ganze einzelne Parzellen braucht der Client hier nicht — die rechnet er
  offline (1 Anteil = Parzellenfläche).
- POST /fertilization/recompute-shares?year=: Nährstoffe und Anteile aller
  Massnahmen eines Jahres neu berechnen (nach GELAN-Re-Import, geänderten
  Düngerart-Werten oder einem Excel-Import ohne Nährstoffe).

Alle metrischen Rechnungen in EPSG:2056 (LV95); Ausgabe wieder WGS84.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from .nutrients import compute_nutrients, parse_dilution
from .tables import TABLE_AREA

pool = get_pool("wiesenjournal")
router = APIRouter()

# Anteile unter 0.5 a sind Rand-Artefakte (Zaun entlang der Grenze) — weg.
MIN_SHARE_A = 0.5


class ResolveRequest(BaseModel):
    season_year: int
    extent_type: Literal["polygon", "track", "parcels"]
    geometry: str | None = None
    track_id: str | None = None
    width_m: float | None = None
    parcel_ids: list[str] | None = None


class Share(BaseModel):
    parcel_id: str
    parcel_name: str
    area_a: float


class ResolveResponse(BaseModel):
    geometry: str
    area_a: float
    unassigned_a: float
    shares: list[Share]


# Gesamtgeometrie je Variante — als CTE "g(geom)" in WGS84.
_GEOM_SQL = {
    "polygon": "select ST_SetSRID(ST_GeomFromGeoJSON(%(geometry)s), 4326) as geom",
    "track": """
        select ST_Transform(
                 ST_Buffer(ST_Transform(t.geometry, 2056), %(width_m)s / 2.0, 'endcap=flat join=round'),
                 4326) as geom
        from tracks t where t.id = %(track_id)s and t.deleted_at is null and t.geometry is not null""",
    "parcels": """
        select ST_Union(p.base_geometry) as geom from parcels p
        where p.id = any(%(parcel_ids)s::uuid[]) and p.deleted_at is null and p.base_geometry is not null""",
}

_RESOLVE_SQL = """
with g as ({geom_sql}),
hits as (
  select p.id, p.name,
         ST_Area(ST_Transform(ST_Intersection(p.base_geometry, g.geom), 2056)) / 100.0 as share_a
  from parcels p, g
  where p.season_year = %(year)s and p.deleted_at is null and p.base_geometry is not null
    and ST_Intersects(p.base_geometry, g.geom)
)
select ST_AsGeoJSON(ST_SimplifyPreserveTopology(g.geom, 0.000005)),
       ST_Area(ST_Transform(g.geom, 2056)) / 100.0 as total_a,
       coalesce((select json_agg(json_build_object('parcel_id', id, 'parcel_name', name, 'area_a', round(share_a::numeric, 2))
                          order by share_a desc)
                 from hits where share_a >= %(min_share)s), '[]'::json)
from g
"""


async def _resolve(conn, extent_type: str, params: dict) -> ResolveResponse:
    sql = _RESOLVE_SQL.format(geom_sql=_GEOM_SQL[extent_type])
    row = await (await conn.execute(sql, params)).fetchone()
    if row is None or row[0] is None:
        raise HTTPException(status_code=422, detail="Keine Geometrie (Track leer / Parzellen ohne Umriss?)")
    geometry, total_a, shares_json = row
    shares = shares_json if isinstance(shares_json, list) else json.loads(shares_json)
    total_a = float(total_a or 0)
    assigned = sum(float(s["area_a"]) for s in shares)
    return ResolveResponse(
        geometry=geometry,
        area_a=round(total_a, 2),
        unassigned_a=round(max(total_a - assigned, 0), 2),
        shares=[Share(parcel_id=str(s["parcel_id"]), parcel_name=s["parcel_name"], area_a=float(s["area_a"])) for s in shares],
    )


@router.post("/fertilization/resolve-extent", response_model=ResolveResponse)
async def resolve_extent(body: ResolveRequest, user: CurrentUser = Depends(require_auth)) -> ResolveResponse:
    area = TABLE_AREA["fertilization_entries"]
    if f"{area}:read" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Leserechte für Düngung")
    if body.extent_type == "polygon" and not body.geometry:
        raise HTTPException(status_code=422, detail="geometry fehlt")
    if body.extent_type == "track" and not (body.track_id and body.width_m):
        raise HTTPException(status_code=422, detail="track_id/width_m fehlen")
    if body.extent_type == "parcels" and not body.parcel_ids:
        raise HTTPException(status_code=422, detail="parcel_ids fehlen")
    params = {
        "year": body.season_year, "geometry": body.geometry, "track_id": body.track_id,
        "width_m": body.width_m, "parcel_ids": body.parcel_ids, "min_share": MIN_SHARE_A,
    }
    async with pool.connection() as conn:
        return await _resolve(conn, body.extent_type, params)


class RecomputeResult(BaseModel):
    year: int
    entries: int
    shares: int
    without_type: int


_HISTORY_SQL = """
insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at)
select gen_random_uuid(), %(table)s, t.id, 'update', %(email)s, now(),
       (to_jsonb(t) {geom_fix})::text, now()
from "{table}" t where t.id = any(%(ids)s::uuid[])
"""


@router.post("/fertilization/recompute-shares", response_model=RecomputeResult)
async def recompute_shares(year: int, user: CurrentUser = Depends(require_auth)) -> RecomputeResult:
    area = TABLE_AREA["fertilization_entries"]
    if f"{area}:write" not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Schreibrechte für Düngung")

    now = datetime.now(timezone.utc)
    touched_entries: list[uuid.UUID] = []
    touched_shares: list[uuid.UUID] = []
    without_type = 0
    async with pool.connection() as conn:
        types = {
            str(r[0]): dict(zip(("id", "n_kg_per_unit", "n_avail_pct", "p2o5_kg_per_unit", "k2o_kg_per_unit",
                                 "dilution_default", "legacy_code", "code"), r))
            for r in await (await conn.execute(
                "select id, n_kg_per_unit, n_avail_pct, p2o5_kg_per_unit, k2o_kg_per_unit, dilution_default, "
                "legacy_code, code from fertilizer_types where deleted_at is null")).fetchall()
        }
        by_legacy = {t["legacy_code"]: t for t in types.values() if t["legacy_code"]}

        entries = await (await conn.execute(
            "select id, parcel_id, duengung_code, amount, fertilizer_type_id, dilution, dilution_factor, "
            "extent_type, track_id, track_width_m, geometry is not null, area_a "
            "from fertilization_entries where deleted_at is null and extract(year from entry_date) = %s",
            (year,))).fetchall()

        for (eid, parcel_id, code, amount, type_id, dilution, dil_factor, extent_type, track_id, width_m,
             has_geom, area_a) in entries:
            ftype = types.get(str(type_id)) if type_id else None
            if ftype is None:
                ftype = by_legacy.get(code)
            if ftype is None:
                without_type += 1
                continue
            factor = float(dil_factor) if dil_factor is not None else parse_dilution(dilution)
            nutrients = compute_nutrients(float(amount) if amount is not None else None, ftype, factor)

            # Anteile
            shares: list[tuple[str, float]] = []
            total_a: float | None = None
            if extent_type == "parcel":
                if parcel_id:
                    row = await (await conn.execute("select area_a from parcels where id = %s", (parcel_id,))).fetchone()
                    pa = float(row[0]) if row and row[0] is not None else None
                    total_a = pa
                    if pa:
                        shares = [(str(parcel_id), pa)]
            else:
                params: dict[str, Any] = {"year": year, "min_share": MIN_SHARE_A}
                kind = extent_type
                if extent_type == "track":
                    params.update(track_id=str(track_id), width_m=float(width_m or 12))
                elif extent_type == "parcels":
                    ids = [r[0] for r in await (await conn.execute(
                        "select parcel_id from fertilization_shares where entry_id = %s and deleted_at is null", (eid,))).fetchall()]
                    params.update(parcel_ids=[str(i) for i in ids])
                    if not ids:
                        kind = "polygon" if has_geom else None
                elif extent_type == "polygon":
                    kind = "polygon" if has_geom else None
                if kind == "polygon" and has_geom:
                    geom_row = await (await conn.execute(
                        "select ST_AsGeoJSON(geometry) from fertilization_entries where id = %s", (eid,))).fetchone()
                    params["geometry"] = geom_row[0]
                if kind:
                    try:
                        res = await _resolve(conn, kind, params)
                        total_a = res.area_a
                        shares = [(s.parcel_id, s.area_a) for s in res.shares]
                        if extent_type == "track":
                            await conn.execute(
                                "update fertilization_entries set geometry = ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) where id = %s",
                                (res.geometry, eid))
                    except HTTPException:
                        pass

            # Totale der Massnahme
            await conn.execute(
                "update fertilization_entries set area_a = coalesce(%s, area_a), n_kg = %s, n_avail_kg = %s, "
                "p2o5_kg = %s, k2o_kg = %s, updated_at = %s where id = %s",
                (total_a, nutrients["n_kg"], nutrients["n_avail_kg"], nutrients["p2o5_kg"], nutrients["k2o_kg"], now, eid))
            touched_entries.append(eid)

            # Anteile: bestehende (je parcel) wiederverwenden, überzählige soft-löschen
            existing = {str(r[1]): r[0] for r in await (await conn.execute(
                "select id, parcel_id from fertilization_shares where entry_id = %s and deleted_at is null", (eid,))).fetchall()}
            base = total_a or (sum(a for _, a in shares) or None)
            keep: set[str] = set()
            for pid, share_a in shares:
                frac = (share_a / base) if base else 0
                sid = existing.get(pid) or uuid.uuid4()
                keep.add(pid)
                vals = {k: (round(v * frac, 2) if v is not None else None) for k, v in nutrients.items()}
                await conn.execute(
                    "insert into fertilization_shares (id, entry_id, parcel_id, area_a, n_kg, n_avail_kg, p2o5_kg, k2o_kg, updated_at, deleted_at) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, null) "
                    "on conflict (id) do update set area_a = excluded.area_a, n_kg = excluded.n_kg, n_avail_kg = excluded.n_avail_kg, "
                    "p2o5_kg = excluded.p2o5_kg, k2o_kg = excluded.k2o_kg, updated_at = excluded.updated_at, deleted_at = null",
                    (sid, eid, pid, share_a, vals["n_kg"], vals["n_avail_kg"], vals["p2o5_kg"], vals["k2o_kg"], now))
                touched_shares.append(sid)
            for pid, sid in existing.items():
                if pid not in keep:
                    await conn.execute("update fertilization_shares set deleted_at = %s, updated_at = %s where id = %s", (now, now, sid))
                    touched_shares.append(sid)

        # changed_by = System-Akteur (nicht der auslösende Nutzer): die Neu-
        # berechnung ändert keine erfassten Werte, und tools/import_*.py
        # erkennt daran, dass die Zeile nicht manuell bearbeitet wurde.
        actor = f"recompute-shares ({user.email})"
        if touched_entries:
            await conn.execute(
                _HISTORY_SQL.format(table="fertilization_entries",
                                    geom_fix="- 'geometry' || jsonb_build_object('geometry', ST_AsGeoJSON(t.geometry))"),
                {"table": "fertilization_entries", "email": actor, "ids": touched_entries})
        if touched_shares:
            await conn.execute(_HISTORY_SQL.format(table="fertilization_shares", geom_fix=""),
                               {"table": "fertilization_shares", "email": actor, "ids": touched_shares})
        await conn.commit()

    return RecomputeResult(year=year, entries=len(touched_entries), shares=len(touched_shares), without_type=without_type)
