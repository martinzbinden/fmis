// FMIS-Fassung (HERKUNFT.json «lokal»): öffnet den AGFF-Store einmal pro Seite, mit pglite als Speicher
// (agff/fmis/persist.ts) statt IndexedDB. Ohne Cloud, Kacheln und Tab-Abgleich: das FMIS hat dafür Sync und
// sein Ereignis «Daten geändert», das auch andere Tabs nach dem Sync erreicht.
import { Store, type Persist } from './store'

let storePromise: Promise<Store> | null = null
let current: Store | null = null
let persistWahl: Persist | null = null

/** Für Tests: anderer Speicher (vor dem ersten getDb setzen). */
export function persistSetzen(p: Persist): void {
  persistWahl = p
}

export function getDb(): Promise<Store> {
  if (!storePromise) {
    // Brücke erst hier laden: Tests der Rechenteile (setDb mit Speicher) brauchen kein pglite
    storePromise = (persistWahl ? Promise.resolve(null) : import('../fmis/persist')).then(async (bruecke) => {
      const s = await Store.open(persistWahl ?? bruecke!.pglitePersist())
      current = s
      bruecke?.binden(s)
      return s
    })
    storePromise.catch(() => {
      storePromise = null
    })
  }
  return storePromise
}

/** Der geöffnete Store (nach getDb(); agff/fmis/AgffSeite.tsx öffnet ihn vor der ersten Seite). */
export function db(): Store {
  if (!current) throw new Error('Datenbank noch nicht geöffnet')
  return current
}

/** Für Tests: Store von aussen setzen. */
export function setDb(s: Store | null): void {
  current = s
  storePromise = s ? Promise.resolve(s) : null
}

/** In der AGFF-App nach dem Zurückspielen einer Sicherung; im FMIS ohne Sicherungsdatei nichts zu tun. */
export function andereTabsNeuLaden(): void {}

export const IDB_NAME = 'fmis-pglite'
