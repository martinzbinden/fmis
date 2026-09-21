import { API_URL, getToken } from '@fmis/core/auth'

export interface OverlapEntry {
  paddock_id: string
  animal_group: string | null
  valid_from: string
  valid_to: string | null
  overlap_a: number
  overlap_pct: number | null
}

export interface ParcelOverlapEntry {
  field_declaration_id: string
  flurname: string | null
  kultur_name_de: string | null
  area_a: number | null
  overlaps: OverlapEntry[]
}

export interface ParcelOverlapReport {
  year: number
  parcels: ParcelOverlapEntry[]
}

/**
 * Server-berechneter Bericht (echte PostGIS-Verschneidung gegen
 * fields.field_declarations, siehe backend/app/reports.py) — anders als der
 * Rest des Moduls KEINE pglite-Abfrage, braucht also Internetverbindung.
 */
export async function fetchParcelOverlapReport(year: number): Promise<ParcelOverlapReport> {
  const res = await fetch(`${API_URL}/wiesenjournal/reports/parcel-overlap?year=${year}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Auswertung fehlgeschlagen (${res.status})`)
  }
  return (await res.json()) as ParcelOverlapReport
}

export interface ParcelNutrients {
  parcel_id: string
  name: string
  farm_name: string | null
  category: string
  kultur_name_de: string | null
  area_a: number | null
  applications: number
  n_kg: number
  n_avail_kg: number
  p2o5_kg: number
  k2o_kg: number
  n_kg_per_ha: number | null
  n_avail_kg_per_ha: number | null
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
  totals_by_farm: NutrientTotals[]
  totals_by_category: NutrientTotals[]
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Abfrage fehlgeschlagen (${res.status})`)
  }
  return (await res.json()) as T
}

export function fetchNutrientReport(year: number): Promise<NutrientReport> {
  return getJson(`/wiesenjournal/reports/nutrients?year=${year}`)
}

export interface FertilizationMapProps {
  n_kg_per_ha: number
  n_avail_kg_per_ha: number
  count: number
  area_a: number
}

/** Verschnitt aller Düngungsmassnahmen des Jahres (backend/app/reports.py) — GeoJSON in WGS84. */
export function fetchFertilizationMap(year: number): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry, FertilizationMapProps>> {
  return getJson(`/wiesenjournal/reports/fertilization-map?year=${year}`)
}

export async function recomputeShares(year: number): Promise<{ entries: number; shares: number; without_type: number }> {
  const res = await fetch(`${API_URL}/wiesenjournal/fertilization/recompute-shares?year=${year}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Neuberechnung fehlgeschlagen (${res.status})`)
  }
  return (await res.json()) as { entries: number; shares: number; without_type: number }
}

/** CSV mit Semikolon (Excel CH öffnet das direkt), Dezimalpunkt bleibt. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]): void {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = [header, ...rows].map((r) => r.map(esc).join(';')).join('\n')
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
