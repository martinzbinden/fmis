import { API_URL, getToken } from '@fmis/core/auth'

export interface ParcelsImportResult {
  year: number
  inserted: number
  updated: number
  unchanged: number
  orphaned: string[]
  deleted: number
}

/**
 * Journal-Parzellen aus den GELAN-Deklarationen des Kulturen-Moduls
 * übernehmen — serverseitig (backend/app/parcels_import.py), weil nur der
 * Server beide Modul-Schemas und die massgebliche Geometrie hat. Braucht
 * Internet; die neuen/geänderten Zeilen kommen danach per Sync-Pull.
 */
export async function importParcelsFromFields(year: number): Promise<ParcelsImportResult> {
  const res = await fetch(`${API_URL}/wiesenjournal/parcels/import-from-fields?year=${year}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Übernahme fehlgeschlagen (${res.status})`)
  }
  return (await res.json()) as ParcelsImportResult
}
