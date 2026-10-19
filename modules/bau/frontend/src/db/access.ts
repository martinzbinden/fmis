// Zugriff für ANDERE Module: öffnet die Ablage dieses Moduls (legt Schema
// und Tabellen an, falls das Modul auf diesem Gerät noch nie offen war) und
// startet dessen Sync, damit die Daten auch ohne Besuch hier ankommen.
import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './pglite'
import { syncClient } from './sync'

export async function getSyncedDb(): Promise<PGlite> {
  syncClient.startSyncLoop()
  return getDb()
}
