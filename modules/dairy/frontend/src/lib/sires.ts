import type { PGlite } from '@electric-sql/pglite'
import { animalKey, animalLabel } from '@fmis/core/earTag'
import { isoDate, localTodayIso } from './format'

/** Jüngere männliche Tiere sind Lämmer/Kälber, keine Vatertiere (ausser schon eingesetzt). */
const MIN_SIRE_AGE_DAYS = 150

export interface SireOption {
  key: string
  ear_tag: string
  name: string | null
  lauf_nr: string | null
  birth_date: string | null
  /** im Bestand (aktiv) */
  present: boolean
  lastUsed: string | null
}

/** Vatertiere zur Auswahl: die männlichen Tiere im Bestand plus (ohne
 * `presentOnly`) alle bisher eingesetzten (Belegungen) — zuletzt eingesetzte
 * zuerst. Bei der Belegung zählen nur anwesende Widder/Stiere; bei der Geburt
 * kann der Vater längst weg sein. */
export async function loadSireOptions(pg: PGlite, { presentOnly = false, today = localTodayIso() } = {}): Promise<SireOption[]> {
  const youngestBirth = new Date(Date.parse(today) - MIN_SIRE_AGE_DAYS * 86_400_000).toISOString().slice(0, 10)
  const [matings, males, pedigree] = await Promise.all([
    pg.query<{ sire_key: string; sire_ear_tag: string | null; sire_name: string | null; last_used: unknown }>(
      `select sire_key, max(sire_ear_tag) as sire_ear_tag, max(sire_name) as sire_name, max(service_date) as last_used
       from matings where deleted_at is null and sire_key is not null group by sire_key`,
    ),
    pg.query<{ ear_tag: string; name: string | null; lauf_nr: string | null; birth_date: unknown }>(
      "select ear_tag, name, lauf_nr, birth_date from animals where deleted_at is null and status = 'aktiv' and sex = 'm'",
    ),
    pg.query<{ animal_key: string; name: string | null; birth_date: unknown }>('select animal_key, name, birth_date from pedigree where deleted_at is null'),
  ])
  const lastUsed = new Map(matings.rows.map((m) => [m.sire_key, isoDate(m.last_used)]))
  const ped = new Map(pedigree.rows.map((p) => [p.animal_key, p]))
  const byKey = new Map<string, SireOption>()
  for (const a of males.rows) {
    const key = animalKey(a.ear_tag)
    if (!key) continue
    const born = isoDate(a.birth_date) ?? isoDate(ped.get(key)?.birth_date)
    if (born && born > youngestBirth && !lastUsed.get(key)) continue
    byKey.set(key, {
      key,
      ear_tag: a.ear_tag,
      name: a.name ?? ped.get(key)?.name ?? null,
      lauf_nr: a.lauf_nr,
      birth_date: born,
      present: true,
      lastUsed: lastUsed.get(key) ?? null,
    })
  }
  if (!presentOnly) {
    for (const m of matings.rows) {
      if (byKey.has(m.sire_key)) continue
      const p = ped.get(m.sire_key)
      byKey.set(m.sire_key, {
        key: m.sire_key,
        ear_tag: m.sire_ear_tag ?? m.sire_key,
        name: m.sire_name ?? p?.name ?? null,
        lauf_nr: null,
        birth_date: isoDate(p?.birth_date),
        present: false,
        lastUsed: isoDate(m.last_used),
      })
    }
  }
  return [...byKey.values()].sort(
    (a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') || (a.birth_date ?? '9').localeCompare(b.birth_date ?? '9') || a.ear_tag.localeCompare(b.ear_tag),
  )
}

export function sireLabel(s: Pick<SireOption, 'ear_tag' | 'name'>): string {
  return animalLabel({ ear_tag: s.ear_tag, name: s.name })
}
