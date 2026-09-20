import { useSyncExternalStore } from 'react'
import type { SyncClient, SyncStatus } from './sync'

export function useSyncStatus(sync: SyncClient): { status: SyncStatus; error: string | null } {
  const status = useSyncExternalStore(sync.subscribeSyncStatus, sync.getSyncStatus)
  const error = useSyncExternalStore(sync.subscribeSyncStatus, sync.getSyncError)
  return { status, error }
}
