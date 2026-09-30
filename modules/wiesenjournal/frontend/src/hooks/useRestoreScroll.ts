import { useCallback, useRef } from 'react'

// Scroll-Position eines Rasters über einen Seitenwechsel hinweg merken (z.B.
// Globus-Knopf → Karte → zurück zu "Raster": dieselbe Zeile soll wieder
// sichtbar sein). Bewusst ein Modul-Objekt statt localStorage: gilt nur
// innerhalb der laufenden Session, nicht geräteübergreifend, und verschwindet
// beim Neuladen der Seite — dann greift stattdessen `fallbackIndex` (z.B.
// das heutige Datum beim allerersten Öffnen).
const positions = new Map<string, { left: number; top: number }>()

function centerLeft(node: HTMLDivElement, index: number, cellWidth: number): number {
  return Math.max(0, index * cellWidth - node.clientWidth / 2 + cellWidth / 2)
}

/** Liefert einen Callback-Ref, der beim Mounten die gemerkte Scroll-Position
 * wiederherstellt (oder, falls noch keine gemerkt ist, den Tag bei
 * `fallbackIndex` mittig zeigt) und danach laufend mitschreibt, plus
 * `scrollToIndex`/`fitCellWidth` für Knöpfe ("Heute", "Ganzes Jahr"). */
export function useRestoreScroll(
  key: string,
  fallbackIndex?: number,
  fallbackCellWidth?: number,
): {
  ref: (node: HTMLDivElement | null) => void
  scrollToIndex: (index: number, cellWidth: number, behavior?: ScrollBehavior) => void
  fitCellWidth: (dayCount: number, labelColWidth: number) => number
} {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const saveRef = useRef<() => void>(() => {})

  // useCallback hält die Ref-Funktion über Re-Renders stabil — sonst würde
  // React sie bei jedem Rendern neu aufrufen (erst mit null, dann mit dem
  // Element) und der Scroll-Listener würde laufend ab-/wieder angehängt.
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (nodeRef.current) nodeRef.current.removeEventListener('scroll', saveRef.current)
      nodeRef.current = node
      if (!node) return
      const saved = positions.get(key)
      if (saved) {
        node.scrollLeft = saved.left
        node.scrollTop = saved.top
      } else if (fallbackIndex != null && fallbackCellWidth != null) {
        // clientWidth ist direkt beim Mounten oft noch 0 (Layout steht erst
        // nach dem nächsten Frame fest) — sonst würde "heute" links
        // abgeschnitten statt mittig landen.
        requestAnimationFrame(() => {
          if (nodeRef.current === node) node.scrollLeft = centerLeft(node, fallbackIndex, fallbackCellWidth)
        })
      }
      saveRef.current = () => positions.set(key, { left: node.scrollLeft, top: node.scrollTop })
      node.addEventListener('scroll', saveRef.current, { passive: true })
    },
    [key, fallbackIndex, fallbackCellWidth],
  )

  const scrollToIndex = useCallback((index: number, cellWidth: number, behavior: ScrollBehavior = 'smooth') => {
    const node = nodeRef.current
    if (!node) return
    node.scrollTo({ left: centerLeft(node, index, cellWidth), behavior })
  }, [])

  const fitCellWidth = useCallback((dayCount: number, labelColWidth: number): number => {
    const node = nodeRef.current
    if (!node || dayCount <= 0) return 0
    return Math.max(1, Math.floor((node.clientWidth - labelColWidth) / dayCount))
  }, [])

  return { ref, scrollToIndex, fitCellWidth }
}
