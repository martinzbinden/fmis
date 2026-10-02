import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from './animalId'
import { isoDate } from './format'

export interface SireOption {
  key: string
  ear_tag: string
  name: string | null
  lastUsed: string | null
}

/** Vatertiere zur Auswahl: alle bisher eingesetzten (Belegungen) plus die
 * männlichen Tiere im Bestand — zuletzt eingesetzte zuerst. */
export async function loadSireOptions(pg: PGlite): Promise<SireOption[]> {
  const [matings, males] = await Promise.all([
    pg.query<{ sire_key: string; sire_ear_tag: string | null; sire_name: string | null; last_used: unknown }>(
      `select sire_key, max(sire_ear_tag) as sire_ear_tag, max(sire_name) as sire_name, max(service_date) as last_used
       from matings where deleted_at is null and sire_key is not null group by sire_key`,
    ),
    pg.query<{ ear_tag: string; name: string | null }>(
      "select ear_tag, name from animals where deleted_at is null and status = 'aktiv' and sex = 'm'",
    ),
  ])
  const byKey = new Map<string, SireOption>()
  for (const m of matings.rows) {
    byKey.set(m.sire_key, { key: m.sire_key, ear_tag: m.sire_ear_tag ?? m.sire_key, name: m.sire_name, lastUsed: isoDate(m.last_used) })
  }
  for (const a of males.rows) {
    const key = animalKey(a.ear_tag)
    if (key && !byKey.has(key)) byKey.set(key, { key, ear_tag: a.ear_tag, name: a.name, lastUsed: null })
  }
  return [...byKey.values()].sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') || (a.name ?? '').localeCompare(b.name ?? ''))
}

export function sireLabel(s: SireOption): string {
  return s.name ? `${s.name} (${s.ear_tag})` : s.ear_tag
}
