import { createSyncClient, type SyncClient } from '@fmis/core/sync'
import { getDb } from './pglite'
import { ensureOutbox, notifyDataChanged } from './write'
import { SYNC_TABLES, DATE_ONLY_COLUMNS } from './tables'

/**
 * Baut den Sync-Client EINER Instanz dieses Moduls (siehe module_registry.py,
 * ModuleSpec.source — dasselbe Modul kann mehrfach instanziert werden, z.B.
 * "dairy" für Kühe und "dairy_schafe" für Schafe). Konsumiert von module.tsx
 * (ModuleDescriptor.sync).
 */
export function createDairySyncClient(key: string): SyncClient {
  return createSyncClient(
    key,
    SYNC_TABLES,
    DATE_ONLY_COLUMNS,
    () => getDb(key),
    ensureOutbox,
    notifyDataChanged,
  )
}
