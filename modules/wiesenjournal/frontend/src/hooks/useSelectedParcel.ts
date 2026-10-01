import { useCallback, useSyncExternalStore } from 'react'

// Markierte Parzellenzeile (farbig hervorgehoben, siehe JournalGrid.tsx /
// JournalGridClassic.tsx) — bleibt bestehen, bis sie abgewählt wird, auch
// über einen Abstecher zur Karte (Globus-Klick) und zurück: die
// Raster-Seite wird beim Routenwechsel komplett neu gemountet, darum reiner
// Modul-Zustand statt useState. Kein localStorage — eine Markierung soll
// nur innerhalb der laufenden Session gelten, nicht über einen Neuladen
// hinweg.
let selected: string | null = null
const listeners = new Set<() => void>()

function read(): string | null {
  return selected
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notify() {
  listeners.forEach((l) => l())
}

export function useSelectedParcel(): {
  selectedId: string | null
  /** Klick auf die Zeile: markiert, nochmaliger Klick wählt wieder ab. */
  toggle: (id: string) => void
  /** Klick auf den Globus: markiert unabhängig vom bisherigen Zustand (kein
   * Abwählen), damit die Zeile nach der Rückkehr von der Karte sicher
   * markiert bleibt. */
  select: (id: string) => void
} {
  const selectedId = useSyncExternalStore(subscribe, read, () => null)
  const toggle = useCallback((id: string) => {
    selected = selected === id ? null : id
    notify()
  }, [])
  const select = useCallback((id: string) => {
    selected = id
    notify()
  }, [])
  return { selectedId, toggle, select }
}
