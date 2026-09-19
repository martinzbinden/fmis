import { useSyncStatus } from '../hooks/useSyncStatus'
import { syncNow } from '../db/sync'

const COLORS: Record<string, string> = {
  synced: 'bg-green-500',
  offline: 'bg-gray-400',
  syncing: 'bg-yellow-400 animate-pulse',
  error: 'bg-red-500',
}

const LABELS: Record<string, string> = {
  synced: 'Synchronisiert',
  offline: 'Offline',
  syncing: 'Synchronisiert…',
  error: 'Sync-Fehler',
}

export default function SyncStatusDot() {
  const { status, error } = useSyncStatus()
  function handleClick() {
    // Auf dem Handy gibt es keinen Hover für den title-Tooltip — bei Fehler
    // also zusätzlich direkt anzeigen, bevor erneut synchronisiert wird.
    if (status === 'error' && error) window.alert(error)
    void syncNow()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={error ?? LABELS[status]}
      className="flex items-center gap-2 rounded-full px-2 py-1 text-xs text-gray-600 active:bg-gray-100"
    >
      <span className={`h-2.5 w-2.5 rounded-full ${COLORS[status]}`} />
      <span className="hidden sm:inline">{LABELS[status]}</span>
    </button>
  )
}
