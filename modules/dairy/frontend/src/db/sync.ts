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
const clients = new Map<string, SyncClient>()

export function createDairySyncClient(key: string): SyncClient {
  let client = clients.get(key)
  if (!client) {
    client = createSyncClient(key, SYNC_TABLES, DATE_ONLY_COLUMNS, () => getDb(key), ensureOutbox, notifyDataChanged)
    clients.set(key, client)
  }
  return client
}

/** Derselbe (gecachte) Client wie in module.tsx — für Seiten, die einen Sync sofort anstossen wollen. */
export const getDairySyncClient = createDairySyncClient
