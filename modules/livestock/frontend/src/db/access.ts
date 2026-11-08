// Zugriff für ANDERE Module (z.B. Proviande-Preise im Milchvieh-Modul): öffnet die
// Ablage dieses Moduls und startet dessen Sync, damit die Daten auch ohne Besuch
// hier ankommen (wie modules/tiere/frontend/src/db/access.ts).
import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './pglite'
import { syncClient } from './sync'

export async function getSyncedDb(): Promise<PGlite> {
  syncClient.startSyncLoop()
  return getDb()
}
