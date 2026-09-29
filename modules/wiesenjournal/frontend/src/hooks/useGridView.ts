import { useCallback, useSyncExternalStore } from 'react'

// Umschalter Raster-Ansicht "neu" (Legenden-Buchstaben, Chip-Editor) vs.
// "klassisch" (schlankeres Raster + einfacher Editor von vor dem
// Excel-Import-Umbau, siehe modules/wiesenjournal/frontend/src/components/
// JournalGridClassic.tsx) — wie useShowAcker.ts pro Gerät, kein Sync.
export type GridView = 'neu' | 'klassisch'

const STORAGE_KEY = 'wiesenjournal_grid_view'
const listeners = new Set<() => void>()

function read(): GridView {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'klassisch' ? 'klassisch' : 'neu'
  } catch {
    return 'neu'
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useGridView(): [GridView, (v: GridView) => void] {
  const value = useSyncExternalStore(subscribe, read, (): GridView => 'neu')
  const set = useCallback((v: GridView) => {
    try {
      localStorage.setItem(STORAGE_KEY, v)
    } catch {
      // privates Fenster o.ä. — dann gilt die Einstellung nur bis zum Reload
    }
    listeners.forEach((l) => l())
  }, [])
  return [value, set]
}
