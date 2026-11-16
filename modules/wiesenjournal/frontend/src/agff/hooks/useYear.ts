import { useCallback, useSyncExternalStore } from 'react'

// Gewählte Saison (Jahr) — pro Gerät gemerkt, für alle Seiten gleich.
const KEY = 'journal_season_year'
const listeners = new Set<() => void>()

function read(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    if (v > 2000 && v < 2100) return v
  } catch {
    // ohne localStorage: laufendes Jahr
  }
  return new Date().getFullYear()
}

export function useYear(): [number, (y: number) => void] {
  const year = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    read,
    read,
  )
  const set = useCallback((y: number) => {
    try {
      localStorage.setItem(KEY, String(y))
    } catch {
      // nur für diese Sitzung
    }
    listeners.forEach((l) => l())
  }, [])
  return [year, set]
}
