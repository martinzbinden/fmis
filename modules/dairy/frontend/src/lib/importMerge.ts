// Schreibweg der Milch-Importe (Herdebuch-Export, TVD) nach der gemeinsamen
// Regel in core/frontend/src/importMerge.ts: nie löschen, nur ergänzen.
// In der App gelöschte Zeilen werden nicht wiederbelebt.

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'
import type { SyncTable } from '../db/tables'
import { keepExisting, sameRow } from '@fmis/core/importMerge'

export { keepExisting, sameValue, sqlDate } from '@fmis/core/importMerge'

/** Schreibt nur, wenn sich etwas ändert; gibt zurück, ob geschrieben wurde. */
export async function writeImportRow(
  pg: PGlite,
  table: SyncTable,
  incoming: Record<string, unknown> & { id: string },
  prev: Record<string, unknown> | undefined,
): Promise<boolean> {
  if (prev?.deleted_at) return false
  const row = keepExisting(incoming, prev)
  if (sameRow(row, prev)) return false
  await upsertRow(pg, table, row as never)
  return true
}
