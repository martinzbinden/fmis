// Tiere sortieren, um sie leichter zu finden (Tierliste und Liste in der
// Tierauswahl): nach Laufnummer, zuletzt abgelammt/abgekalbt, jüngste zuerst
// oder zuletzt behandelt.

import type { PGlite } from '@electric-sql/pglite'
import { isoDate } from './format'
import type { Species } from './fertility'
import type { Animal } from '../types'

export type AnimalSort = 'nr' | 'geburt' | 'jung' | 'behandelt'
export const ANIMAL_SORTS: AnimalSort[] = ['nr', 'geburt', 'jung', 'behandelt']

export function sortLabel(sort: AnimalSort, species: Species): string {
  if (sort === 'geburt') return species === 'sheep' ? 'zuletzt abgelammt' : 'zuletzt abgekalbt'
  if (sort === 'jung') return 'jüngste zuerst'
  if (sort === 'behandelt') return 'zuletzt behandelt'
  return 'Laufnummer'
}

export interface AnimalFacts {
  /** letzte Geburt als Mutter */
  last_birth: string | null
  /** letzte Behandlung oder Krankheit im Journal */
  last_treatment: string | null
}

export async function loadAnimalFacts(pg: PGlite): Promise<Map<string, AnimalFacts>> {
  const { rows } = await pg.query<{ id: string; last_birth: unknown; last_treatment: unknown }>(`
    select a.id,
      (select max(b.birth_date) from births b where b.dam_id = a.id and b.deleted_at is null) as last_birth,
      (select max(j.entry_date) from animal_journal j where j.animal_id = a.id and j.deleted_at is null
         and j.category in ('behandlung', 'krankheit')) as last_treatment
    from animals a where a.deleted_at is null`)
  return new Map(rows.map((r) => [r.id, { last_birth: isoDate(r.last_birth), last_treatment: isoDate(r.last_treatment) }]))
}

type Sortable = Pick<Animal, 'id' | 'lauf_nr' | 'ear_tag' | 'birth_date'>

/** Datum, nach dem sortiert wird (für die Anzeige neben dem Tier); null bei Laufnummer. */
export function sortDate(a: Sortable, facts: Map<string, AnimalFacts> | undefined, sort: AnimalSort): string | null {
  if (sort === 'geburt') return facts?.get(a.id)?.last_birth ?? null
  if (sort === 'behandelt') return facts?.get(a.id)?.last_treatment ?? null
  if (sort === 'jung') return isoDate(a.birth_date)
  return null
}

/** Laufnummer aufsteigend, Tiere ohne Laufnummer danach (nach Ohrmarke). */
const byNr = (x: Sortable, y: Sortable) =>
  Number(!x.lauf_nr) - Number(!y.lauf_nr) ||
  (x.lauf_nr ?? '').localeCompare(y.lauf_nr ?? '', 'de-CH', { numeric: true }) ||
  x.ear_tag.localeCompare(y.ear_tag)

/** Neueste zuerst; Tiere ohne Datum ans Ende (nach Laufnummer). */
export function sortAnimals<T extends Sortable>(list: T[], facts: Map<string, AnimalFacts> | undefined, sort: AnimalSort): T[] {
  if (sort === 'nr') return [...list].sort(byNr)
  return [...list].sort((x, y) => {
    const dx = sortDate(x, facts, sort)
    const dy = sortDate(y, facts, sort)
    if (dx && dy && dx !== dy) return dy.localeCompare(dx)
    if (!!dx !== !!dy) return dx ? -1 : 1
    return byNr(x, y)
  })
}
