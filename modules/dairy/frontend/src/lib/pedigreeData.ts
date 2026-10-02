import type { PGlite } from '@electric-sql/pglite'
import { Inbreeding, type PedigreeLink } from './inbreeding'

/** Stammbaum der Instanz als Inzucht-Rechner (Schlüssel = animalKey). */
export async function loadInbreeding(pg: PGlite): Promise<Inbreeding> {
  const { rows } = await pg.query<{ animal_key: string; sire_key: string | null; dam_key: string | null }>(
    'select animal_key, sire_key, dam_key from pedigree where deleted_at is null',
  )
  return new Inbreeding(new Map<string, PedigreeLink>(rows.map((r) => [r.animal_key, { sire: r.sire_key, dam: r.dam_key }])))
}
