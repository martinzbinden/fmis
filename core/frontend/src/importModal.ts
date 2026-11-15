// Import als Fenster über der aktuellen Seite (frontend/src/ImportModal.tsx) statt eigener Seite: man bleibt, wo man
// war. Einmal geöffnet bleibt der Import im Hintergrund aufgebaut, damit laufende Importe beim Schliessen weitergehen;
// `busy` zeigt das am 📥-Knopf an.

import { useSyncExternalStore } from 'react'

export interface ImportModalState {
  open: boolean
  /** schon einmal geöffnet: der Import bleibt aufgebaut (läuft weiter, auch wenn geschlossen) */
  mounted: boolean
  /** etwas wird erkannt oder importiert */
  busy: boolean
}

let state: ImportModalState = { open: false, mounted: false, busy: false }
const listeners = new Set<() => void>()
const set = (patch: Partial<ImportModalState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const openImport = () => set({ open: true, mounted: true })
export const closeImport = () => set({ open: false })
export const setImportBusy = (busy: boolean) => {
  if (state.busy !== busy) set({ busy })
}

export function useImportModal(): ImportModalState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
