import { useEffect, useSyncExternalStore } from 'react'
import type { SyncClient, SyncStatus } from './sync'

/** Status, Fehlertext und Anzahl offener (noch nicht gesendeter) Einträge.
 * Der Zähler wird alle paar Sekunden aus der lokalen Outbox nachgeführt, damit
 * er auch nach einer Eingabe stimmt, die noch auf den nächsten Sync wartet. */
export function useSyncStatus(sync: SyncClient): { status: SyncStatus; error: string | null; pending: number } {
  const status = useSyncExternalStore(sync.subscribeSyncStatus, sync.getSyncStatus)
  const error = useSyncExternalStore(sync.subscribeSyncStatus, sync.getSyncError)
  const pending = useSyncExternalStore(sync.subscribeSyncStatus, sync.getPendingCount)
  useEffect(() => {
    void sync.refreshPending()
    const id = setInterval(() => void sync.refreshPending(), 3000)
    return () => clearInterval(id)
  }, [sync])
  return { status, error, pending }
}
