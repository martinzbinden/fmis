// Zugriff für ANDERE Module (z.B. Betriebsdaten im Modul Betrieb): öffnet die
// Ablage dieses Moduls und startet dessen Sync, damit die Daten auch ohne
// Besuch hier ankommen.
import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './pglite'
import { syncClient } from './sync'

export async function getSyncedDb(): Promise<PGlite> {
  syncClient.startSyncLoop()
  return getDb()
}
