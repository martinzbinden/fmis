// Tiere dieser Instanz für Herdengruppen und Standorte (core/frontend/src/
// animals.ts, Wiesenjournal → Herden): aktive Tiere mit Laktationszahl und
// Trocken-Status; Trockenstellen beim Zügeln aus einer gemolkenen Gruppe.

import type { AnimalProvider, AnimalRef, ReaderFacts } from '@fmis/core/animals'
import { shortEarTag } from '@fmis/core/earTag'
import { getDb } from '../db/pglite'
import { getDairySyncClient } from '../db/sync'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import { isDrySql } from './dryOff'
import { isoDate, localTodayIso, num } from './format'
import { loadHerdContext } from './herdContext'
import { speciesOf } from './species'

export function createDairyAnimalProvider(moduleKey: string, title: string): AnimalProvider {
  const species = speciesOf(moduleKey) === 'sheep' ? 'schafe' : 'rinder'
  return {
    title,
    species,
    async listAnimals(): Promise<AnimalRef[]> {
      const pg = await getDb(moduleKey)
      const { rows } = await pg.query<Record<string, unknown>>(
        `select a.id, a.ear_tag, a.lauf_nr, a.name, a.sex, a.birth_date,
           greatest(
             coalesce((select max(l.lactation_number) from lactations l where l.animal_id = a.id and l.deleted_at is null), 0),
             coalesce((select count(*) from births b where b.dam_id = a.id and b.deleted_at is null), 0)
           ) as parity,
           ${isDrySql('a')} as dry
         from animals a where a.deleted_at is null and a.status = 'aktiv'
         order by a.lauf_nr nulls last, a.ear_tag`,
      )
      return rows.map((r) => {
        const ear = String(r.ear_tag)
        const lauf = (r.lauf_nr as string | null) ?? null
        return {
          moduleKey,
          id: String(r.id),
          ear_tag: ear,
          lauf_nr: lauf,
          name: (r.name as string | null) ?? null,
          label: [lauf, shortEarTag(ear)].filter(Boolean).join(' · '),
          sex: (r.sex as AnimalRef['sex']) ?? null,
          birth_date: isoDate(r.birth_date),
          species,
          parity: num(r.parity),
          dry: Boolean(r.dry),
        }
      })
    },
    async listWatchlists() {
      const pg = await getDb(moduleKey)
      const { rows } = await pg.query<{ id: string; name: string; animal_ids: string[] | null }>(
        `select l.id, l.name,
           array_agg(e.animal_id::text order by e.added_at) filter (where e.id is not null) as animal_ids
         from watchlists l
         left join watchlist_entries e on e.list_id = l.id and e.deleted_at is null and e.done_at is null
         where l.deleted_at is null and l.archived_at is null
         group by l.id, l.name order by l.name`,
      )
      return rows.map((r) => ({ id: String(r.id), name: r.name, animalIds: r.animal_ids ?? [] }))
    },
    async readerFacts() {
      // gleiche Auswertung wie Tierdetail und Ausmerzliste: letzte Geburt, Untersuchung seit dieser Geburt
      const pg = await getDb(moduleKey)
      const context = await loadHerdContext(pg, speciesOf(moduleKey), localTodayIso())
      const out = new Map<string, ReaderFacts>()
      for (const [id, c] of context) {
        out.set(id, {
          lastBirth: c.fertility.last_birth,
          pregnancy: c.pregnancy ? { date: c.pregnancy.date, result: c.pregnancy.result } : null,
        })
      }
      return out
    },
    async dryOff(animalIds, date, note) {
      const pg = await getDb(moduleKey)
      await inTransaction(pg, async (tx) => {
        for (const id of animalIds) {
          await upsertRow(tx, 'animal_journal', {
            id: crypto.randomUUID(),
            animal_id: id,
            entry_date: date,
            source: 'manual',
            text: note,
            ref_id: null,
            category: 'trocken',
          })
        }
      })
      void getDairySyncClient(moduleKey).syncNow()
    },
  }
}
