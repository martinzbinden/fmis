// Mastlämmer für Herdengruppen und Standorte (core/frontend/src/animals.ts,
// Wiesenjournal → Herden).

import type { AnimalProvider, AnimalRef } from '@fmis/core/animals'
import { shortEarTag } from '@fmis/core/earTag'
import { getDb } from '../db/pglite'

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? null : String(v).slice(0, 10))

export const livestockAnimalProvider: AnimalProvider = {
  title: 'Mastplaner',
  species: 'schafe',
  async listAnimals(): Promise<AnimalRef[]> {
    const pg = await getDb()
    const { rows } = await pg.query<Record<string, unknown>>(
      "select id, ear_tag, sex, birth_date from animals where deleted_at is null and status = 'aktiv' order by ear_tag",
    )
    return rows.map((r) => ({
      moduleKey: 'livestock',
      id: String(r.id),
      ear_tag: String(r.ear_tag),
      lauf_nr: null,
      name: null,
      label: shortEarTag(String(r.ear_tag)),
      sex: (r.sex as AnimalRef['sex']) ?? null,
      birth_date: iso(r.birth_date),
      species: 'schafe',
      parity: 0,
      fattening: true,
    }))
  },
}
