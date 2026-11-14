// Plausibilitätsprüfung des Vaters einer Geburt: Gibt es zum Muttertier eine Belegung, die zur Tragzeit
// passt, und stammt sie vom eingetragenen Vater? Ohne passende Belegung ist der Vater «unklar» — solange
// nicht bekannt ist, welcher Bock bei welcher Gruppe war, werden diese Geburten immer markiert (z. B. wenn
// zwei Böcke nacheinander im Einsatz waren und die Belegung nicht erfasst wurde).

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { addDays, isoDate } from './format'
import { GESTATION_DAYS, type Species } from './fertility'

/** Toleranz um die Tragzeit (Tage): Schafe 150 ± 15, Rinder 283 ± 15. */
export const GESTATION_TOLERANCE = 15
/** Belegungs-Zeiträume (Import) über diese Dauer hinaus zählen nur ab ihrem Beginn: sie sind meist «bis auf Weiteres». */
const MAX_RANGE_DAYS = 60

export interface MatingLite {
  service_date: string
  service_to: string | null
  sire_key: string | null
}

export type SireState = 'belegt' | 'unklar' | 'ohne'

/** Belegungen, die zur Geburt passen (Empfängnis in Tragzeit ± Toleranz vor dem Geburtsdatum). */
export function matingsInWindow(birthDate: string, matings: MatingLite[], species: Species): MatingLite[] {
  const g = GESTATION_DAYS[species]
  const from = addDays(birthDate, -(g + GESTATION_TOLERANCE))
  const to = addDays(birthDate, -(g - GESTATION_TOLERANCE))
  return matings.filter((m) => {
    const end = m.service_to && m.service_to >= m.service_date ? m.service_to : m.service_date
    const capped = end > addDays(m.service_date, MAX_RANGE_DAYS) ? addDays(m.service_date, MAX_RANGE_DAYS) : end
    return m.service_date <= to && capped >= from
  })
}

/** `ohne`: kein Vater eingetragen (nichts zu prüfen); `belegt`: eine passende Belegung nennt diesen Vater;
 * `unklar`: keine passende Belegung oder nur von anderen Böcken. */
export function sireCheck(birth: { birth_date: string; sire_key: string | null }, matings: MatingLite[], species: Species): SireState {
  if (!birth.sire_key) return 'ohne'
  const hits = matingsInWindow(birth.birth_date, matings, species)
  return hits.some((m) => m.sire_key === birth.sire_key) ? 'belegt' : 'unklar'
}

/** Vater für die Vorbelegung: nur wenn die Belegung zur Tragzeit passt und eindeutig ist (sonst leer lassen). */
export function sireForBirth(birthDate: string, matings: MatingLite[], species: Species): MatingLite | null {
  const hits = matingsInWindow(birthDate, matings, species).filter((m) => m.sire_key)
  const keys = new Set(hits.map((m) => m.sire_key))
  if (keys.size !== 1) return null
  return [...hits].sort((a, b) => (a.service_date < b.service_date ? 1 : -1))[0]!
}

/** Geburten mit unklarem Vater (Schlüssel = births.id), ab `sinceIso`. */
export async function loadSireDoubts(pg: PGlite, species: Species, sinceIso = '2025-01-01'): Promise<Set<string>> {
  const [births, matings] = await Promise.all([
    pg.query<{ id: string; dam_id: string; birth_date: unknown; sire_key: string | null; sire_ear_tag: string | null }>(
      `select id, dam_id, birth_date, sire_key, sire_ear_tag from births
       where deleted_at is null and birth_date >= $1 and (sire_key is not null or sire_ear_tag is not null)`,
      [sinceIso],
    ),
    pg.query<{ animal_id: string; service_date: unknown; service_to: unknown; sire_key: string | null }>(
      'select animal_id, service_date, service_to, sire_key from matings where deleted_at is null',
    ),
  ])
  const byDam = new Map<string, MatingLite[]>()
  for (const m of matings.rows) {
    const list = byDam.get(m.animal_id) ?? []
    list.push({ service_date: isoDate(m.service_date)!, service_to: isoDate(m.service_to), sire_key: m.sire_key })
    byDam.set(m.animal_id, list)
  }
  const doubts = new Set<string>()
  for (const b of births.rows) {
    const key = b.sire_key ?? animalKey(b.sire_ear_tag ?? '')
    if (sireCheck({ birth_date: isoDate(b.birth_date)!, sire_key: key }, byDam.get(b.dam_id) ?? [], species) === 'unklar') doubts.add(b.id)
  }
  return doubts
}
