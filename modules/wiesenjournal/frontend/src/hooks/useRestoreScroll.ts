import { useCallback, useRef } from 'react'

// Scroll-Position eines Rasters über einen Seitenwechsel hinweg merken (z.B.
// Globus-Knopf → Karte → zurück zu "Raster": dieselbe Zeile soll wieder
// sichtbar sein). Bewusst ein Modul-Objekt statt localStorage: gilt nur
// innerhalb der laufenden Session, nicht geräteübergreifend, und verschwindet
// beim Neuladen der Seite (dann wieder von oben — kein verwirrender Sprung
// nach einem Tag Pause).
const positions = new Map<string, { left: number; top: number }>()

/** Liefert einen Callback-Ref, der beim Mounten die gemerkte Scroll-Position
 * wiederherstellt und danach laufend mitschreibt. */
export function useRestoreScroll(key: string): (node: HTMLDivElement | null) => void {
  const nodeRef = useRef<HTMLDivElement | null>(null)
  const saveRef = useRef<() => void>(() => {})

  // useCallback hält die Ref-Funktion über Re-Renders stabil — sonst würde
  // React sie bei jedem Rendern neu aufrufen (erst mit null, dann mit dem
  // Element) und der Scroll-Listener würde laufend ab-/wieder angehängt.
  return useCallback(
    (node: HTMLDivElement | null) => {
      if (nodeRef.current) nodeRef.current.removeEventListener('scroll', saveRef.current)
      nodeRef.current = node
      if (!node) return
      const saved = positions.get(key)
      if (saved) {
        node.scrollLeft = saved.left
        node.scrollTop = saved.top
      }
      saveRef.current = () => positions.set(key, { left: node.scrollLeft, top: node.scrollTop })
      node.addEventListener('scroll', saveRef.current, { passive: true })
    },
    [key],
  )
}
