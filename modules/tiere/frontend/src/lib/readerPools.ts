// Gruppen vom Lesegerät (Tabelle reader_pools, abgelegt vom Server): Status nach dem Import oder Verwerfen setzen.

import { getCurrentUserEmail } from '@fmis/core/auth'
import { getDb } from '../db/pglite'
import { upsertRow } from '../db/write'

/** Zeile `poolId` als importiert (mit der angelegten Gruppe) oder verworfen markieren. Die Zeile muss schon auf dem Gerät sein (Sync). */
export async function markPool(poolId: string, next: 'importiert' | 'verworfen', groupId?: string): Promise<void> {
  const pg = await getDb()
  const { rows } = await pg.query<Record<string, unknown>>('select * from reader_pools where id = $1', [poolId])
  if (!rows[0]) return
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
  await upsertRow('reader_pools', {
    ...rows[0],
    id: poolId,
    fetched_at: iso(rows[0].fetched_at),
    scanned_at: iso(rows[0].scanned_at),
    handled_at: new Date().toISOString(),
    status: next,
    handled_by: getCurrentUserEmail(),
    imported_group_id: groupId ?? null,
    deleted_at: null,
  } as never)
}
