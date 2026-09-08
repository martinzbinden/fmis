import { useSyncExternalStore } from 'react'
import { subscribeSyncStatus, getSyncStatus, getSyncError, type SyncStatus } from '../db/sync'

export function useSyncStatus(): { status: SyncStatus; error: string | null } {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
  const error = useSyncExternalStore(subscribeSyncStatus, getSyncError)
  return { status, error }
}
