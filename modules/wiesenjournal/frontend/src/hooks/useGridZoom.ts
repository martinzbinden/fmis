import { useCallback, useSyncExternalStore } from 'react'

// Spaltenbreite des Journal-Rasters — wie ein Zeitleisten-Zoom in einem
// Schnittprogramm: mehr Tage gleichzeitig sichtbar (schmal) oder besser
// lesbar (breit). Pro Gerät (localStorage), kein Sync.
const STEPS = [16, 20, 24, 28, 34, 40, 48] as const
const DEFAULT_STEP_INDEX = 4 // 34px, bisheriger fester Wert

const STORAGE_KEY = 'wiesenjournal_grid_cell_width'
const listeners = new Set<() => void>()

function read(): number {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY))
    return STEPS.includes(raw as (typeof STEPS)[number]) ? raw : STEPS[DEFAULT_STEP_INDEX]
  } catch {
    return STEPS[DEFAULT_STEP_INDEX]
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function write(v: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(v))
  } catch {
    // privates Fenster o.ä. — dann gilt der Zoom nur bis zum Reload
  }
  listeners.forEach((l) => l())
}

export function useGridZoom(): { cellWidth: number; canZoomIn: boolean; canZoomOut: boolean; zoomIn: () => void; zoomOut: () => void } {
  const cellWidth = useSyncExternalStore(subscribe, read, (): number => STEPS[DEFAULT_STEP_INDEX])
  const idx = STEPS.indexOf(cellWidth as (typeof STEPS)[number])

  const zoomIn = useCallback(() => {
    const i = STEPS.indexOf(read() as (typeof STEPS)[number])
    if (i < STEPS.length - 1) write(STEPS[i + 1])
  }, [])
  const zoomOut = useCallback(() => {
    const i = STEPS.indexOf(read() as (typeof STEPS)[number])
    if (i > 0) write(STEPS[i - 1])
  }, [])

  return { cellWidth, canZoomIn: idx < STEPS.length - 1, canZoomOut: idx > 0, zoomIn, zoomOut }
}
