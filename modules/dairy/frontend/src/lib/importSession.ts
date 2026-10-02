// Import-Sitzung einer Milch-Instanz (Kühe/Schafe) gegen den Serverstand —
// siehe core/frontend/src/importSession.ts.

import { openImportSession, type ImportSession } from '@fmis/core/importSession'
import { getDb, migrations } from '../db/pglite'
import { getDairySyncClient } from '../db/sync'
import { DATE_ONLY_COLUMNS, SYNC_TABLES } from '../db/tables'
import { ensureOutbox } from '../db/write'

export function openDairyImport(moduleKey: string): Promise<ImportSession> {
  return openImportSession({
    moduleKey,
    migrations,
    syncTables: SYNC_TABLES,
    dateOnlyColumns: DATE_ONLY_COLUMNS,
    ensureOutbox,
    sync: getDairySyncClient(moduleKey),
    localDb: () => getDb(moduleKey),
  })
}
