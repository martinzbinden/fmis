import { useCallback, useSyncExternalStore } from 'react'

// Umschalter "Ackerkulturen anzeigen" — gilt app-weit für Raster, Karte,
// Parzellenliste und Journal-Liste, überlebt Reloads (localStorage) und ist
// pro Gerät (kein Sync — reine Anzeige-Einstellung). useSyncExternalStore
// statt useState, damit alle gleichzeitig gemounteten Seiten dieselbe
// Änderung sofort sehen.
const STORAGE_KEY = 'wiesenjournal_show_acker'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useShowAcker(): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(subscribe, read, () => false)
  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch {
      // privates Fenster o.ä. — dann gilt die Einstellung nur bis zum Reload
    }
    listeners.forEach((l) => l())
  }, [])
  return [value, set]
}

/** SQL-Fragment für Parzellen-Abfragen: Acker nur mit Umschalter. */
export function categoryFilterSql(showAcker: boolean): string {
  return showAcker ? '' : " and category <> 'acker'"
}
