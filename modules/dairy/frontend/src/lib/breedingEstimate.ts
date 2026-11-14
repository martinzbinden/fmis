// Zuchtwert aus der Abstammung schätzen (eigene Schätzung, nie mit gemessenen Zuchtwerten vermischt): fehlt dem Tier ein
// eigener Gesamtzuchtwert, gilt das Mittel der Eltern. Fehlt ein Elternteil, zählt für ihn das Populationsmittel 100
// (GZW und ISET liegen um 100): ein bekannter Elternteil zählt dann halb. Kennt man keinen Elternwert, gibt es keine Schätzung.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import type { AnimalContext } from './herdContext'

export const POPULATION_MEAN = 100

export interface BreedingEstimate {
  value: number
  /** welche Eltern einflossen */
  basis: 'beide' | 'mutter' | 'vater'
  dam: number | null
  sire: number | null
}

export function estimateFromParents(dam: number | null, sire: number | null): BreedingEstimate | null {
  if (dam == null && sire == null) return null
  const d = dam ?? POPULATION_MEAN
  const s = sire ?? POPULATION_MEAN
  return { value: Math.round(((d + s) / 2) * 10) / 10, basis: dam != null && sire != null ? 'beide' : dam != null ? 'mutter' : 'vater', dam, sire }
}

export interface ParentLinks {
  /** Tierschlüssel → Vater-/Mutterschlüssel (Tabelle pedigree) */
  parents: Map<string, { sire: string | null; dam: string | null }>
  /** Tierschlüssel → Zuchtwert aus dem Leistungsausweis (Tiere ausserhalb des Bestands: Widder, Vorfahren) */
  external: Map<string, number>
}

export async function loadParentLinks(pg: PGlite, trait: string): Promise<ParentLinks> {
  const [ped, ext] = await Promise.all([
    pg.query<{ animal_key: string; sire_key: string | null; dam_key: string | null }>('select animal_key, sire_key, dam_key from pedigree where deleted_at is null'),
    pg.query<{ animal_key: string; value: unknown; eval_date: unknown }>('select animal_key, value, eval_date from pedigree_breeding_values where deleted_at is null and trait = $1 order by eval_date', [trait]),
  ])
  return {
    parents: new Map(ped.rows.map((r) => [r.animal_key, { sire: r.sire_key, dam: r.dam_key }])),
    external: new Map(ext.rows.map((r) => [r.animal_key, Number(r.value)])),
  }
}

/** Schätzung für jedes Tier ohne eigenen Wert; Schlüssel = Tier-ID. */
export function estimateAll(context: ReadonlyMap<string, AnimalContext>, links: ParentLinks, trait: string): Map<string, BreedingEstimate> {
  const own = new Map<string, number>()
  for (const c of context.values()) {
    const v = c.breedingValues[trait]?.value
    const k = animalKey(c.animal.ear_tag)
    if (v != null && k) own.set(k, v)
  }
  const valueOf = (key: string | null) => (key ? (own.get(key) ?? links.external.get(key) ?? null) : null)
  const out = new Map<string, BreedingEstimate>()
  for (const c of context.values()) {
    if (c.breedingValues[trait]?.value != null) continue
    const k = animalKey(c.animal.ear_tag)
    const p = k ? links.parents.get(k) : undefined
    if (!p) continue
    const e = estimateFromParents(valueOf(p.dam), valueOf(p.sire))
    if (e) out.set(c.animal.id, e)
  }
  return out
}
