import { useCallback, useSyncExternalStore } from 'react'

// Umschalter "Ackerkulturen" und "Miniflächen" — gelten app-weit für
// Raster, Karte, Parzellenliste, Journal-Liste und Auswertung, überleben
// Reloads (localStorage) und sind pro Gerät (kein Sync — reine
// Anzeige-Einstellung). Standard: beide aus. useSyncExternalStore statt
// useState, damit alle gleichzeitig gemounteten Seiten dieselbe Änderung
// sofort sehen.
function displayToggle(storageKey: string): () => [boolean, (v: boolean) => void] {
  const listeners = new Set<() => void>()

  function read(): boolean {
    try {
      return localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return function useToggle() {
    const value = useSyncExternalStore(subscribe, read, () => false)
    const set = useCallback((v: boolean) => {
      try {
        localStorage.setItem(storageKey, v ? '1' : '0')
      } catch {
        // privates Fenster o.ä. — dann gilt die Einstellung nur bis zum Reload
      }
      listeners.forEach((l) => l())
    }, [])
    return [value, set]
  }
}

export const useShowAcker = displayToggle('wiesenjournal_show_acker')
export const useShowSmall = displayToggle('wiesenjournal_show_small')

/** Unter dieser Fläche (Aren) gilt eine Parzelle als Minifläche. */
export const SMALL_PARCEL_A = 5

/** Minifläche? Parzellen ohne Flächenangabe zählen nicht dazu. */
export function isSmallParcel(p: { area_a: number | string | null }): boolean {
  return p.area_a != null && Number(p.area_a) < SMALL_PARCEL_A
}

/** SQL-Fragment für Parzellen-Abfragen: Acker und Miniflächen nur mit Umschalter. */
export function categoryFilterSql(showAcker: boolean, showSmall = true): string {
  return (showAcker ? '' : " and category <> 'acker'") + (showSmall ? '' : ` and (area_a is null or area_a >= ${SMALL_PARCEL_A})`)
}
