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
