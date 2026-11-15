import { useState } from 'react'
import type { SyncStatus } from './sync'
import SyncStatusPanel from './SyncStatusPanel'
import { cachedModules } from './modulesApi'

const COLORS: Record<SyncStatus, string> = {
  synced: 'bg-green-500',
  offline: 'bg-gray-500',
  syncing: 'bg-yellow-400 animate-pulse',
  error: 'bg-red-500',
}

const LABELS: Record<SyncStatus, string> = {
  synced: 'Synchronisiert',
  offline: 'Offline',
  syncing: 'Synchronisiert…',
  error: 'Sync-Fehler',
}

/** Sync-Anzeige: Punkt plus Text. Auf dem Handy erscheint der Text, sobald
 * etwas offen ist, offline geht oder ein Fehler vorliegt — nie nur die Farbe.
 * Mindestens 48 px hoch (Touch). */
export default function SyncStatusDot({
  status,
  error,
  pending = 0,
  onSync,
}: {
  status: SyncStatus
  error: string | null
  pending?: number
  onSync: () => void
}) {
  // Antippen gleicht ab (wie bisher) und öffnet die Status-Anzeige: Abgleich je Modul mit Fehlertext, Dienste,
  // Speicher, Programmversion (SyncStatusPanel.tsx)
  const [panel, setPanel] = useState(false)
  function handleClick() {
    onSync()
    setPanel(true)
  }

  const open = pending > 0
  const label = status === 'synced' && open ? `${pending} offen` : status === 'error' && open ? `Fehler · ${pending} offen` : LABELS[status]
  // Mobile: Text nur wenn es etwas zu sagen gibt
  const needsText = status !== 'synced' || open
  const tooltip = error ?? (open ? `${pending} Änderung${pending === 1 ? '' : 'en'} noch nicht auf dem Server` : label)

  return (
    <>
    <button
      type="button"
      onClick={handleClick}
      title={tooltip}
      aria-label={`${label}. Abgleichen und Status anzeigen.`}
      aria-haspopup="dialog"
      className="flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full px-3 text-xs font-medium text-gray-700 active:bg-gray-100"
    >
      <span className={`h-3 w-3 shrink-0 rounded-full ${COLORS[status]}`} />
      <span aria-live="polite" className={needsText ? '' : 'hidden sm:inline'}>
        {label}
      </span>
    </button>
    {panel && <SyncStatusPanel onClose={() => setPanel(false)} titles={Object.fromEntries((cachedModules() ?? []).map((m) => [m.key, m.title]))} />}
    </>
  )
}
