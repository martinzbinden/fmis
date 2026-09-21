import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getToken } from '@fmis/core/auth'
import { upsertRow, softDeleteRow } from '../db/write'
import { computeNutrients, parseDilution, type Nutrients } from './nutrients'
import { isoDate, num } from './format'
import type { ExtentType, FertilizationEntry, FertilizationShare, FertilizerType, Parcel } from '../types'

export async function loadFertilizerTypes(pg: PGlite, activeOnly = true): Promise<FertilizerType[]> {
  const { rows } = await pg.query<FertilizerType>(
    `select * from fertilizer_types where deleted_at is null${activeOnly ? ' and active' : ''} order by sort_order, code`,
  )
  return rows.map((t) => ({
    ...t,
    n_kg_per_unit: num(t.n_kg_per_unit) ?? 0,
    n_avail_pct: num(t.n_avail_pct) ?? 0,
    p2o5_kg_per_unit: num(t.p2o5_kg_per_unit) ?? 0,
    k2o_kg_per_unit: num(t.k2o_kg_per_unit) ?? 0,
    mg_kg_per_unit: num(t.mg_kg_per_unit),
    dilution_default: num(t.dilution_default) ?? 1,
    container_size: num(t.container_size),
  }))
}

export interface ResolveResult {
  geometry: string
  area_a: number
  unassigned_a: number
  shares: { parcel_id: string; parcel_name: string; area_a: number }[]
}

/**
 * Serverseitige PostGIS-Verschneidung (backend/app/fertilization.py) —
 * braucht Internet. Nur für Polygon/Track/mehrere Parzellen; eine einzelne
 * ganze Parzelle rechnet saveFertilizationEntry() offline.
 */
export async function resolveExtent(input: {
  season_year: number
  extent_type: 'polygon' | 'track' | 'parcels'
  geometry?: string
  track_id?: string
  width_m?: number
  parcel_ids?: string[]
}): Promise<ResolveResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Flächenbezug Polygon/Track braucht eine Internetverbindung (Berechnung auf dem Server).')
  }
  const res = await fetch(`${API_URL}/wiesenjournal/fertilization/resolve-extent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Flächenberechnung fehlgeschlagen (${res.status})`)
  }
  return (await res.json()) as ResolveResult
}

export interface FertInput {
  id: string | null
  anchorParcel: Parcel
  entry_date: string
  season_year: number
  type: FertilizerType | null
  duengung_code: string
  amount: number | null
  unit: 'm3' | 't' | 'kg'
  container_count: number | null
  dilution: string | null
  gabe_number: number | null
  notes: string | null
  extent_type: ExtentType
  extra_parcels: Parcel[]          // bei 'parcels'
  geometry: string | null          // bei 'polygon'
  track_id: string | null          // bei 'track'
  track_width_m: number | null
  import_key: string | null
}

function scaleNutrients(n: Nutrients, frac: number): Nutrients {
  const s = (v: number | null) => (v == null ? null : Math.round(v * frac * 100) / 100)
  return { n_kg: s(n.n_kg), n_avail_kg: s(n.n_avail_kg), p2o5_kg: s(n.p2o5_kg), k2o_kg: s(n.k2o_kg) }
}

/**
 * Schreibt eine Düngungsmassnahme inkl. Nährstoff-Totalen und Anteilen je
 * Parzelle. Ganze Parzelle(n) offline (Anteil = Parzellenfläche), Polygon/
 * Track über resolveExtent(). Alte Anteile der Massnahme werden ersetzt.
 */
export async function saveFertilizationEntry(pg: PGlite, input: FertInput): Promise<void> {
  const id = input.id ?? crypto.randomUUID()
  const dilutionFactor = parseDilution(input.dilution)
  const nutrients = computeNutrients(input.amount, input.type, dilutionFactor)

  let geometry: string | null = null
  let areaA: number | null = null
  let shares: { parcel_id: string; area_a: number }[] = []
  let anchorId: string | null = input.anchorParcel.id

  if (input.extent_type === 'parcel') {
    areaA = num(input.anchorParcel.area_a)
    if (areaA) shares = [{ parcel_id: input.anchorParcel.id, area_a: areaA }]
  } else if (input.extent_type === 'parcels') {
    const all = [input.anchorParcel, ...input.extra_parcels.filter((p) => p.id !== input.anchorParcel.id)]
    shares = all.filter((p) => num(p.area_a)).map((p) => ({ parcel_id: p.id, area_a: num(p.area_a)! }))
    areaA = Math.round(shares.reduce((s, x) => s + x.area_a, 0) * 100) / 100
  } else {
    const res = await resolveExtent({
      season_year: input.season_year,
      extent_type: input.extent_type,
      geometry: input.geometry ?? undefined,
      track_id: input.track_id ?? undefined,
      width_m: input.track_width_m ?? undefined,
    })
    geometry = res.geometry
    areaA = res.area_a
    shares = res.shares.map((s) => ({ parcel_id: s.parcel_id, area_a: s.area_a }))
    // Anker = grösster Anteil (für Raster/Journal-Liste), sonst die geklickte Parzelle
    anchorId = shares[0]?.parcel_id ?? input.anchorParcel.id
  }

  await upsertRow('fertilization_entries', {
    id,
    parcel_id: anchorId,
    entry_date: input.entry_date,
    duengung_code: input.duengung_code,
    amount: input.amount,
    unit: input.unit,
    gabe_number: input.gabe_number,
    notes: input.notes,
    fertilizer_type_id: input.type?.id ?? null,
    dilution: input.dilution,
    dilution_factor: dilutionFactor,
    container_count: input.container_count,
    extent_type: input.extent_type,
    track_id: input.extent_type === 'track' ? input.track_id : null,
    track_width_m: input.extent_type === 'track' ? input.track_width_m : null,
    geometry,
    area_a: areaA,
    ...nutrients,
    import_key: input.import_key,
  } as never)

  const { rows: existing } = await pg.query<FertilizationShare>(
    'select * from fertilization_shares where entry_id = $1 and deleted_at is null',
    [id],
  )
  const byParcel = new Map(existing.map((s) => [s.parcel_id, s]))
  const base = areaA || shares.reduce((s, x) => s + x.area_a, 0) || 0
  const kept = new Set<string>()
  for (const share of shares) {
    const frac = base ? share.area_a / base : 0
    const prev = byParcel.get(share.parcel_id)
    kept.add(share.parcel_id)
    await upsertRow('fertilization_shares', {
      id: prev?.id ?? crypto.randomUUID(),
      entry_id: id,
      parcel_id: share.parcel_id,
      area_a: share.area_a,
      ...scaleNutrients(nutrients, frac),
    } as never)
  }
  for (const prev of existing) {
    if (!kept.has(prev.parcel_id)) await softDeleteRow('fertilization_shares', prev.id)
  }
}

export async function deleteFertilizationEntry(pg: PGlite, id: string): Promise<void> {
  const { rows } = await pg.query<{ id: string }>(
    'select id from fertilization_shares where entry_id = $1 and deleted_at is null',
    [id],
  )
  for (const r of rows) await softDeleteRow('fertilization_shares', r.id)
  await softDeleteRow('fertilization_entries', id)
}

/** Anteile aller Massnahmen in einem Datumsbereich (fürs Raster: Massnahme auf jeder betroffenen Parzelle). */
export async function loadSharesInRange(
  pg: PGlite,
  from: string,
  to: string,
): Promise<{ share: FertilizationShare; entry_date: string }[]> {
  const { rows } = await pg.query<FertilizationShare & { entry_date: string }>(
    `select s.*, e.entry_date from fertilization_shares s
     join fertilization_entries e on e.id = s.entry_id and e.deleted_at is null
     where s.deleted_at is null and e.entry_date between $1 and $2`,
    [from, to],
  )
  return rows.map((r) => ({ share: r, entry_date: isoDate(r.entry_date) }))
}

/** Nährstoff-Summe einer Parzelle in einer Saison (offline, aus den Anteilen). */
export async function loadParcelNutrientTotals(
  pg: PGlite,
  parcelId: string,
  seasonYear: number,
): Promise<{ n_kg: number; n_avail_kg: number; p2o5_kg: number; k2o_kg: number; applications: number }> {
  const { rows } = await pg.query<{ n_kg: unknown; n_avail_kg: unknown; p2o5_kg: unknown; k2o_kg: unknown; applications: unknown }>(
    `select coalesce(sum(s.n_kg), 0) as n_kg, coalesce(sum(s.n_avail_kg), 0) as n_avail_kg,
            coalesce(sum(s.p2o5_kg), 0) as p2o5_kg, coalesce(sum(s.k2o_kg), 0) as k2o_kg,
            count(distinct s.entry_id) as applications
     from fertilization_shares s
     join fertilization_entries e on e.id = s.entry_id and e.deleted_at is null
     where s.parcel_id = $1 and s.deleted_at is null and extract(year from e.entry_date) = $2`,
    [parcelId, seasonYear],
  )
  const r = rows[0]
  return {
    n_kg: num(r?.n_kg) ?? 0,
    n_avail_kg: num(r?.n_avail_kg) ?? 0,
    p2o5_kg: num(r?.p2o5_kg) ?? 0,
    k2o_kg: num(r?.k2o_kg) ?? 0,
    applications: num(r?.applications) ?? 0,
  }
}
