// Import-Sitzung der Kulturen gegen den Serverstand — siehe
// core/frontend/src/importSession.ts.

import { openImportSession, type ImportSession } from '@fmis/core/importSession'
import { getDb, migrations } from '../db/pglite'
import { syncClient } from '../db/sync'
import { DATE_ONLY_COLUMNS, SYNC_TABLES } from '../db/tables'
import { ensureOutbox } from '../db/write'

export function openFieldsImport(): Promise<ImportSession> {
  return openImportSession({
    moduleKey: 'fields',
    migrations,
    syncTables: SYNC_TABLES,
    dateOnlyColumns: DATE_ONLY_COLUMNS,
    ensureOutbox,
    sync: syncClient,
    localDb: getDb,
  })
}
