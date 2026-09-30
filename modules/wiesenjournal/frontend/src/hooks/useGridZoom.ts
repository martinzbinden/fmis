import { useCallback, useSyncExternalStore } from 'react'

// Spaltenbreite des Journal-Rasters — wie ein Zeitleisten-Zoom in einem
// Schnittprogramm: mehr Tage gleichzeitig sichtbar (schmal) oder besser
// lesbar (breit). Pro Gerät (localStorage), kein Sync.
const STEPS = [16, 20, 24, 28, 34, 40, 48] as const
const DEFAULT_STEP_INDEX = 4 // 34px, bisheriger fester Wert
export const READABLE_CELL_WIDTH = 40 // "Heute"-Knopf: bewusst grösser als der Default, gut lesbar
const MIN_CELL_WIDTH = 6 // Untergrenze für "Ganzes Jahr" (frei berechnet, kein fixer Schritt)
const MAX_CELL_WIDTH = 64

const STORAGE_KEY = 'wiesenjournal_grid_cell_width'
const listeners = new Set<() => void>()

function read(): number {
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEY))
    return raw >= MIN_CELL_WIDTH && raw <= MAX_CELL_WIDTH ? raw : STEPS[DEFAULT_STEP_INDEX]
  } catch {
    return STEPS[DEFAULT_STEP_INDEX]
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function write(v: number): void {
  const clamped = Math.min(MAX_CELL_WIDTH, Math.max(MIN_CELL_WIDTH, Math.round(v)))
  try {
    localStorage.setItem(STORAGE_KEY, String(clamped))
  } catch {
    // privates Fenster o.ä. — dann gilt der Zoom nur bis zum Reload
  }
  listeners.forEach((l) => l())
}

export function useGridZoom(): {
  cellWidth: number
  canZoomIn: boolean
  canZoomOut: boolean
  zoomIn: () => void
  zoomOut: () => void
  setCellWidth: (v: number) => void
} {
  const cellWidth = useSyncExternalStore(subscribe, read, (): number => STEPS[DEFAULT_STEP_INDEX])

  // "Ganzes Jahr" setzt einen frei berechneten Wert (nicht notwendigerweise
  // einer der STEPS) — zoomIn/zoomOut suchen deshalb den nächstgelegenen
  // Schritt statt sich auf den aktuellen Wert als exakten Treffer zu
  // verlassen (STEPS.indexOf hätte sonst -1 geliefert und wäre steckengeblieben).
  const zoomIn = useCallback(() => {
    const current = read()
    const next = STEPS.find((s) => s > current)
    write(next ?? STEPS[STEPS.length - 1])
  }, [])
  const zoomOut = useCallback(() => {
    const current = read()
    const next = [...STEPS].reverse().find((s) => s < current)
    write(next ?? STEPS[0])
  }, [])
  const setCellWidth = useCallback((v: number) => write(v), [])

  return {
    cellWidth,
    canZoomIn: cellWidth < STEPS[STEPS.length - 1],
    canZoomOut: cellWidth > STEPS[0],
    zoomIn,
    zoomOut,
    setCellWidth,
  }
}
