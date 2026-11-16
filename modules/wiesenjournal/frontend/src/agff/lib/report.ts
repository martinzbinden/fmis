// Nährstoffbericht je Parzelle — im FMIS GET /wiesenjournal/reports/nutrients (backend/app/reports.py), hier direkt
// aus dem Store.

import type { Store } from '../db/store'
import { num } from './format'
import { kgPerHa } from './nutrients'
import { fertilizationOverlay, toLv, toWgs, unionAll, type LvMulti, type OverlayFace } from './geo'

export interface ParcelNutrients {
  parcel_id: string
  name: string
  farm_name: string | null
  category: string
  kultur_name_de: string | null
  area_a: number | null
  immer_zeigen: boolean
  applications: number
  incomplete: number
  n_kg: number
  n_avail_kg: number
  p2o5_kg: number
  k2o_kg: number
  n_kg_per_ha: number | null
  n_avail_kg_per_ha: number | null
  p2o5_kg_per_ha: number | null
  k2o_kg_per_ha: number | null
}

export interface NutrientTotals {
  key: string
  area_a: number
  n_kg: number
  n_avail_kg: number
  p2o5_kg: number
  k2o_kg: number
  n_kg_per_ha: number | null
}

export interface NutrientReport {
  year: number
  parcels: ParcelNutrients[]
  totalsByFarm: NutrientTotals[]
  totalsByCategory: NutrientTotals[]
  total: NutrientTotals
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function loadNutrientReport(s: Store, year: number): NutrientReport {
  const entries = new Map(s.rows('fertilization_entries').filter((e) => e.entry_date.startsWith(String(year))).map((e) => [e.id, e]))
  type Acc = { n: number; na: number; p: number; k: number; apps: Set<string>; inc: Set<string> }
  const acc = new Map<string, Acc>()
  for (const x of s.rows('fertilization_shares')) {
    const e = entries.get(x.entry_id)
    if (!e) continue
    const a = acc.get(x.parcel_id) ?? { n: 0, na: 0, p: 0, k: 0, apps: new Set<string>(), inc: new Set<string>() }
    a.n += num(x.n_kg) ?? 0
    a.na += num(x.n_avail_kg) ?? 0
    a.p += num(x.p2o5_kg) ?? 0
    a.k += num(x.k2o_kg) ?? 0
    a.apps.add(e.id)
    if (e.incomplete) a.inc.add(e.id)
    acc.set(x.parcel_id, a)
  }
  const parcels: ParcelNutrients[] = s
    .rows('parcels')
    .filter((p) => p.season_year === year)
    .sort(
      (a, b) =>
        (a.farm_name ?? '￿').localeCompare(b.farm_name ?? '￿') ||
        a.category.localeCompare(b.category) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name, 'de'),
    )
    .map((p) => {
      const a = acc.get(p.id)
      const area = num(p.area_a)
      const n = r2(a?.n ?? 0)
      const na = r2(a?.na ?? 0)
      const pp = r2(a?.p ?? 0)
      const k = r2(a?.k ?? 0)
      return {
        parcel_id: p.id,
        name: p.name,
        farm_name: p.farm_name,
        category: p.category,
        kultur_name_de: p.kultur_name_de,
        area_a: area,
        immer_zeigen: !!p.immer_zeigen,
        applications: a?.apps.size ?? 0,
        incomplete: a?.inc.size ?? 0,
        n_kg: n,
        n_avail_kg: na,
        p2o5_kg: pp,
        k2o_kg: k,
        n_kg_per_ha: kgPerHa(n, area),
        n_avail_kg_per_ha: kgPerHa(na, area),
        p2o5_kg_per_ha: kgPerHa(pp, area),
        k2o_kg_per_ha: kgPerHa(k, area),
      }
    })
  const totals = (keyFn: (p: ParcelNutrients) => string): NutrientTotals[] => {
    const map = new Map<string, NutrientTotals>()
    for (const p of parcels) {
      const key = keyFn(p)
      const t = map.get(key) ?? { key, area_a: 0, n_kg: 0, n_avail_kg: 0, p2o5_kg: 0, k2o_kg: 0, n_kg_per_ha: null }
      t.area_a += p.area_a ?? 0
      t.n_kg += p.n_kg
      t.n_avail_kg += p.n_avail_kg
      t.p2o5_kg += p.p2o5_kg
      t.k2o_kg += p.k2o_kg
      map.set(key, t)
    }
    const r1 = (v: number) => Math.round(v * 10) / 10
    return [...map.values()].map((t) => ({
      ...t,
      area_a: r2(t.area_a),
      n_kg: r1(t.n_kg),
      n_avail_kg: r1(t.n_avail_kg),
      p2o5_kg: r1(t.p2o5_kg),
      k2o_kg: r1(t.k2o_kg),
      n_kg_per_ha: kgPerHa(t.n_kg, t.area_a),
    }))
  }
  return {
    year,
    parcels,
    totalsByFarm: totals((p) => p.farm_name ?? '–'),
    totalsByCategory: totals((p) => p.category),
    total: totals(() => 'Total')[0] ?? { key: 'Total', area_a: 0, n_kg: 0, n_avail_kg: 0, p2o5_kg: 0, k2o_kg: 0, n_kg_per_ha: null },
  }
}

export interface FertMapFeature {
  type: 'Feature'
  geometry: ReturnType<typeof toWgs>
  properties: Omit<OverlayFace, 'geom'>
}

/** Düngungskarte des Jahres: Verschnitt aller Massnahmen (lib/geo.ts). */
export function loadFertilizationMap(s: Store, year: number): { features: FertMapFeature[]; skipped: number; ms: number } {
  const t0 = performance.now()
  const entries = s
    .rows('fertilization_entries')
    .filter((e) => e.entry_date.startsWith(String(year)) && e.n_kg != null)
    .sort((a, b) => (a.entry_date < b.entry_date ? -1 : 1))
  const parcels = new Map(s.rows('parcels').map((p) => [p.id, p]))
  const parcelGeoms = new Map<string, LvMulti[]>()
  for (const x of s.rows('fertilization_shares')) {
    const g = toLv(parcels.get(x.parcel_id)?.base_geometry)
    if (g) parcelGeoms.set(x.entry_id, [...(parcelGeoms.get(x.entry_id) ?? []), g])
  }
  let skipped = 0
  const inputs = []
  for (const e of entries) {
    const area = num(e.area_a)
    let geom: LvMulti | null = null
    try {
      geom = e.extent_type === 'polygon' ? toLv(e.geometry) : unionAll(parcelGeoms.get(e.id) ?? [])
    } catch {
      geom = null
    }
    if (!geom || !geom.length || !area) {
      skipped++
      continue
    }
    inputs.push({ geom, n_kg_per_ha: kgPerHa(num(e.n_kg), area) ?? 0, n_avail_kg_per_ha: kgPerHa(num(e.n_avail_kg), area) ?? 0 })
  }
  let faces: OverlayFace[] = []
  try {
    faces = fertilizationOverlay(inputs)
  } catch (err) {
    throw new Error(`Düngungskarte konnte nicht berechnet werden: ${err instanceof Error ? err.message : String(err)}`)
  }
  return {
    features: faces.map(({ geom, ...props }) => ({ type: 'Feature', geometry: toWgs(geom), properties: props })),
    skipped,
    ms: Math.round(performance.now() - t0),
  }
}

/** CSV mit Semikolon (Excel CH öffnet das direkt), Dezimalpunkt bleibt. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const t = v == null ? '' : String(v)
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return [header, ...rows].map((r) => r.map(esc).join(';')).join('\n')
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]): void {
  downloadBlob(filename, new Blob(['﻿' + toCsv(header, rows)], { type: 'text/csv;charset=utf-8' }))
}
