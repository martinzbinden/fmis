// Import als Seitenfenster der Kopfzeile (frontend/src/ImportModal.tsx, core/SidePanel.tsx). Einmal geöffnet bleibt
// der Import aufgebaut, damit laufende Importe beim Schliessen weitergehen; `busy` zeigt das am 📥-Knopf an.

import { useSyncExternalStore } from 'react'
import { closePanel, openPanel, useOpenPanel } from './headerPanel'

export interface ImportModalState {
  open: boolean
  /** schon einmal geöffnet: der Import bleibt aufgebaut (läuft weiter, auch wenn geschlossen) */
  mounted: boolean
  /** etwas wird erkannt oder importiert */
  busy: boolean
}

let state = { mounted: false, busy: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<typeof state>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const openImport = () => openImportWith()
/** `survivesNavigation`: der folgende Seitenwechsel schliesst nicht (alte Adresse /import springt zurück) */
export const openImportWith = (opts: { survivesNavigation?: boolean } = {}) => {
  if (!state.mounted) set({ mounted: true })
  openPanel('import', opts)
}
export const closeImport = () => closePanel('import')
export const setImportBusy = (busy: boolean) => {
  if (state.busy !== busy) set({ busy })
}

export function useImportModal(): ImportModalState {
  const open = useOpenPanel() === 'import'
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
  return { open, mounted: s.mounted, busy: s.busy }
}
