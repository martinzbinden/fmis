import { createSyncClient, type SyncClient } from '@fmis/core/sync'
import { getDb } from './pglite'
import { ensureOutbox, notifyDataChanged } from './write'
import { SYNC_TABLES, DATE_ONLY_COLUMNS } from './tables'

/** Eigenständiger Sync-Client dieses Moduls, konsumiert von module.tsx (ModuleDescriptor.sync). */
export const syncClient: SyncClient = createSyncClient(
  'dairy',
  SYNC_TABLES,
  DATE_ONLY_COLUMNS,
  getDb,
  ensureOutbox,
  notifyDataChanged,
)
