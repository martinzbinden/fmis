// Markierungen der Ausmerzliste (schema/0030): Daumen hoch/runter je Tier, gespeichert und abgeglichen.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import { isoDate } from './format'
import type { Mark } from './cullingPlan'
import { stableUuid } from './treatments'

/** Feste id je Tier: eine neue Markierung ersetzt die alte. */
export const markId = (animalId: string) => stableUuid(`culling:${animalId}`)

export async function loadCullingMarks(pg: PGlite): Promise<Map<string, Mark>> {
  const { rows } = await pg.query<{ animal_id: string; mark: Mark }>('select animal_id, mark from culling_marks where deleted_at is null')
  return new Map(rows.map((r) => [r.animal_id, r.mark]))
}

/** Markierung setzen; `null` nimmt sie weg (zurück in die Automatik). */
export async function setCullingMark(pg: PGlite, animalId: string, mark: Mark | null, today: string): Promise<void> {
  await upsertRow(pg, 'culling_marks', {
    id: markId(animalId),
    animal_id: animalId,
    mark: mark ?? 'leben',
    marked_on: today,
    created_by: getCurrentUserEmail(),
    deleted_at: mark ? null : new Date().toISOString(),
  })
}

/** Neue Runde: alle Markierungen weg. */
export async function clearCullingMarks(pg: PGlite): Promise<void> {
  const { rows } = await pg.query<{ id: string; animal_id: string; mark: string; marked_on: unknown }>('select id, animal_id, mark, marked_on from culling_marks where deleted_at is null')
  await inTransaction(pg, async (tx) => {
    for (const r of rows) await upsertRow(tx, 'culling_marks', { id: r.id, animal_id: r.animal_id, mark: r.mark, marked_on: isoDate(r.marked_on), deleted_at: new Date().toISOString() })
  })
}
