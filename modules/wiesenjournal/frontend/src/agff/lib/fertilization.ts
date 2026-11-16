// Aus fmis modules/wiesenjournal/frontend/src/lib/fertilization.ts (59425bb).
// Teilflächen (Polygon) rechnet der Browser (lib/geo.ts) statt der Server mit PostGIS — alles offline.
// Seit Etappe 1c ohne SQL: der Store hält alle Zeilen im Speicher (db/store.ts).

import type { Store } from '../db/store'
import { computeNutrients, parseDilution, type Nutrients } from './nutrients'
import { num } from './format'
import { computeShares, prepareParcels, toLv } from './geo'
import type { ExtentType, FertilizationShare, FertilizerType, FertUnit, Parcel } from '../types'

export function loadFertilizerTypes(s: Store, activeOnly = true): FertilizerType[] {
  return s
    .rows('fertilizer_types')
    .filter((t) => !activeOnly || t.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    .map((t) => ({
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

export interface FertInput {
  id: string | null
  anchorParcel: Parcel
  entry_date: string
  season_year: number
  type: FertilizerType | null
  amount: number | null
  container_count: number | null
  container_size: number | null
  dilution: string | null
  gabe_number: number | null
  notes: string | null
  extent_type: ExtentType
  extra_parcels: Parcel[] // bei 'parcels'
  geometry: string | null // bei 'polygon'
  trip_id?: string | null
  incomplete?: boolean
}

function scaleNutrients(n: Nutrients, frac: number): Nutrients {
  const sc = (v: number | null) => (v == null ? null : Math.round(v * frac * 100) / 100)
  return { n_kg: sc(n.n_kg), n_avail_kg: sc(n.n_avail_kg), p2o5_kg: sc(n.p2o5_kg), k2o_kg: sc(n.k2o_kg) }
}

/** Menge: explizit, sonst Anzahl Gefässe × Inhalt. */
export function effectiveAmount(amount: number | null, count: number | null, size: number | null): number | null {
  if (amount != null) return amount
  if (count != null && size) return Math.round(count * size * 100) / 100
  return null
}

export function seasonParcels(s: Store, year: number): Parcel[] {
  return s.rows('parcels').filter((p) => p.season_year === year)
}

/** Flächenbezug auflösen: Gesamtfläche und Anteile je Parzelle. */
export function resolveExtent(
  s: Store,
  input: Pick<FertInput, 'extent_type' | 'anchorParcel' | 'extra_parcels' | 'geometry' | 'season_year'>,
): { area_a: number | null; shares: { parcel_id: string; area_a: number }[]; anchorId: string | null } {
  if (input.extent_type === 'parcel') {
    const a = num(input.anchorParcel.area_a)
    return { area_a: a, shares: a ? [{ parcel_id: input.anchorParcel.id, area_a: a }] : [], anchorId: input.anchorParcel.id }
  }
  if (input.extent_type === 'parcels') {
    const all = [input.anchorParcel, ...input.extra_parcels.filter((p) => p.id !== input.anchorParcel.id)]
    const shares = all.filter((p) => num(p.area_a)).map((p) => ({ parcel_id: p.id, area_a: num(p.area_a)! }))
    const total = Math.round(shares.reduce((x, y) => x + y.area_a, 0) * 100) / 100
    return { area_a: total, shares, anchorId: input.anchorParcel.id }
  }
  const extent = toLv(input.geometry)
  if (!extent) throw new Error('Keine Fläche gezeichnet.')
  const res = computeShares(extent, prepareParcels(seasonParcels(s, input.season_year)))
  return {
    area_a: res.area_a,
    shares: res.shares.map((x) => ({ parcel_id: x.parcel_id, area_a: x.area_a })),
    // Anker = grösster Anteil (Raster/Journal), sonst die angeklickte Parzelle
    anchorId: res.shares[0]?.parcel_id ?? input.anchorParcel.id,
  }
}

/** Schreibt eine Düngungsmassnahme inkl. Nährstoff-Totalen und Anteilen je Parzelle. Alte Anteile werden ersetzt. */
export function saveFertilizationEntry(s: Store, input: FertInput): string {
  const id = input.id ?? crypto.randomUUID()
  const dilutionFactor = parseDilution(input.dilution)
  const amount = effectiveAmount(input.amount, input.container_count, input.container_size)
  const nutrients = computeNutrients(amount, input.type, dilutionFactor)
  const { area_a, shares, anchorId } = resolveExtent(s, input)
  s.batch(() => {
    s.put('fertilization_entries', {
      id,
      parcel_id: anchorId,
      entry_date: input.entry_date,
      fertilizer_type_id: input.type?.id ?? null,
      code: input.type?.code ?? '?',
      amount,
      unit: (input.type?.unit ?? 'm3') as FertUnit,
      container_count: input.container_count,
      container_size: input.container_count != null ? input.container_size : null,
      dilution: input.dilution,
      dilution_factor: dilutionFactor,
      gabe_number: input.gabe_number,
      extent_type: input.extent_type,
      geometry: input.extent_type === 'polygon' ? input.geometry : null,
      area_a,
      ...nutrients,
      trip_id: input.trip_id ?? null,
      incomplete: input.incomplete ?? false,
      notes: input.notes,
    })
    writeShares(s, id, area_a, shares, nutrients)
  })
  return id
}

function sharesOf(s: Store, entryId: string): FertilizationShare[] {
  return s.rows('fertilization_shares').filter((x) => x.entry_id === entryId)
}

function writeShares(s: Store, entryId: string, areaA: number | null, shares: { parcel_id: string; area_a: number }[], nutrients: Nutrients) {
  const existing = sharesOf(s, entryId)
  const byParcel = new Map(existing.map((x) => [x.parcel_id, x]))
  const base = areaA || shares.reduce((a, x) => a + x.area_a, 0) || 0
  const kept = new Set<string>()
  for (const share of shares) {
    kept.add(share.parcel_id)
    s.put('fertilization_shares', {
      id: byParcel.get(share.parcel_id)?.id ?? crypto.randomUUID(),
      entry_id: entryId,
      parcel_id: share.parcel_id,
      area_a: share.area_a,
      ...scaleNutrients(nutrients, base ? share.area_a / base : 0),
    })
  }
  for (const prev of existing) if (!kept.has(prev.parcel_id)) s.softDelete('fertilization_shares', prev.id)
}

export function deleteFertilizationEntry(s: Store, id: string): void {
  s.batch(() => {
    for (const x of sharesOf(s, id)) s.softDelete('fertilization_shares', x.id)
    s.softDelete('fertilization_entries', id)
  })
}

/** Nährstoffe und Anteile aller Massnahmen eines Jahres neu rechnen — nach einem GELAN-Re-Import (andere Flächen)
 * oder geänderten Düngerart-Werten. Ersetzt POST /fertilization/recompute-shares des FMIS. */
export function recomputeYear(s: Store, year: number): { entries: number; withoutType: number } {
  const types = new Map(loadFertilizerTypes(s, false).map((t) => [t.id, t]))
  const parcels = seasonParcels(s, year)
  const byId = new Map(parcels.map((p) => [p.id, p]))
  const prepared = prepareParcels(parcels)
  const entries = s.rows('fertilization_entries').filter((e) => e.entry_date.startsWith(String(year)))
  let withoutType = 0
  s.batch(() => {
    for (const e of entries) {
      const type = e.fertilizer_type_id ? (types.get(e.fertilizer_type_id) ?? null) : null
      if (!type) withoutType++
      const nutrients = computeNutrients(num(e.amount), type, num(e.dilution_factor))
      let areaA: number | null = null
      let shares: { parcel_id: string; area_a: number }[] = []
      if (e.extent_type === 'polygon') {
        const g = toLv(e.geometry)
        if (g) {
          const r = computeShares(g, prepared)
          areaA = r.area_a
          shares = r.shares
        }
      } else if (e.extent_type === 'parcels') {
        shares = sharesOf(s, e.id)
          .map((x) => byId.get(x.parcel_id))
          .filter((p): p is Parcel => !!p && num(p.area_a) != null)
          .map((p) => ({ parcel_id: p.id, area_a: num(p.area_a)! }))
        areaA = Math.round(shares.reduce((a, x) => a + x.area_a, 0) * 100) / 100
      } else {
        const p = e.parcel_id ? byId.get(e.parcel_id) : undefined
        areaA = num(p?.area_a)
        if (p && areaA) shares = [{ parcel_id: p.id, area_a: areaA }]
      }
      s.put('fertilization_entries', { id: e.id, area_a: areaA ?? e.area_a, ...nutrients, code: type?.code ?? e.code })
      writeShares(s, e.id, areaA, shares, nutrients)
    }
  })
  return { entries: entries.length, withoutType }
}

/** Anteile aller Massnahmen in einem Datumsbereich (Raster: Massnahme auf jeder betroffenen Parzelle). */
export function loadSharesInRange(s: Store, from: string, to: string): { share: FertilizationShare; entry_date: string }[] {
  const dates = new Map<string, string>()
  for (const e of s.rows('fertilization_entries')) if (e.entry_date >= from && e.entry_date <= to) dates.set(e.id, e.entry_date)
  return s
    .rows('fertilization_shares')
    .filter((x) => dates.has(x.entry_id))
    .map((x) => ({ share: x, entry_date: dates.get(x.entry_id)! }))
}

/** Nährstoff-Summe einer Parzelle in einer Saison (aus den Anteilen). */
export function loadParcelNutrientTotals(
  s: Store,
  parcelId: string,
  seasonYear: number,
): { n_kg: number; n_avail_kg: number; p2o5_kg: number; k2o_kg: number; applications: number } {
  const year = String(seasonYear)
  const live = new Set(s.rows('fertilization_entries').filter((e) => e.entry_date.startsWith(year)).map((e) => e.id))
  const t = { n_kg: 0, n_avail_kg: 0, p2o5_kg: 0, k2o_kg: 0, applications: 0 }
  const seen = new Set<string>()
  for (const x of s.rows('fertilization_shares')) {
    if (x.parcel_id !== parcelId || !live.has(x.entry_id)) continue
    t.n_kg += num(x.n_kg) ?? 0
    t.n_avail_kg += num(x.n_avail_kg) ?? 0
    t.p2o5_kg += num(x.p2o5_kg) ?? 0
    t.k2o_kg += num(x.k2o_kg) ?? 0
    seen.add(x.entry_id)
  }
  t.applications = seen.size
  const r2 = (v: number) => Math.round(v * 100) / 100
  return { n_kg: r2(t.n_kg), n_avail_kg: r2(t.n_avail_kg), p2o5_kg: r2(t.p2o5_kg), k2o_kg: r2(t.k2o_kg), applications: t.applications }
}
