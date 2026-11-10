import { API_URL } from './auth'

// Testumgebung (dev-fmis): Der Server sagt, welche Instanz läuft und welcher Datenstand
// gilt (core/backend/fmis_core/release.py). Bekommt die Testumgebung einen frischen
// Abzug von Prod, ändert der Datenstand — dann passen die lokale Kopie und die
// Sync-Marken nicht mehr zum Server: alles Lokale verwerfen und neu holen. Prod
// liefert keinen Datenstand, dort passiert nie etwas.

export interface InstanceInfo {
  instanz: string | null
  datenstand: string | null
}

const KEY = 'fmis_datenstand'
// '' = Prod (schon einmal gefragt): dann nie auf die Antwort warten
const KIND_KEY = 'fmis_instanz'
let info: InstanceInfo = { instanz: null, datenstand: null }

export function instanceInfo(): InstanceInfo {
  return info
}

/** Lokale Datenbanken (pglite in IndexedDB) und Sync-Marken löschen. */
async function wipeLocal(): Promise<void> {
  let names = ['/pglite/fmis']
  try {
    const dbs = await indexedDB.databases()
    names = dbs.map((d) => d.name ?? '').filter((n) => n.startsWith('/pglite/'))
  } catch {
    /* ältere Browser: nur die gemeinsame Datenbank */
  }
  await Promise.all(
    names.map(
      (n) =>
        new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(n)
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        }),
    ),
  )
  for (const k of Object.keys(localStorage)) if (k.endsWith('_sync_since') || k.endsWith('_sync_schema')) localStorage.removeItem(k)
}

/** Vor dem ersten Öffnen der lokalen Datenbank aufrufen (frontend/src/main.tsx). Offline: nichts tun. */
export async function checkInstance(): Promise<InstanceInfo> {
  let known: string | null = null
  try {
    known = localStorage.getItem(KIND_KEY)
  } catch {
    /* ohne localStorage */
  }
  if (known === '') {
    // im Hintergrund nur nachführen, nie löschen (die Datenbank ist dann schon offen)
    void fetchAndCheck(false)
    return info
  }
  return fetchAndCheck(true)
}

async function fetchAndCheck(mayWipe: boolean): Promise<InstanceInfo> {
  try {
    const res = await fetch(`${API_URL}/core/instance`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return info
    const data = (await res.json()) as Partial<InstanceInfo>
    info = { instanz: data.instanz ?? null, datenstand: data.datenstand ?? null }
    localStorage.setItem(KIND_KEY, info.instanz ?? '')
  } catch {
    return info
  }
  if (!info.datenstand || !mayWipe) return info
  try {
    const before = localStorage.getItem(KEY)
    if (before !== info.datenstand) {
      // auch beim ersten Besuch: eine Kopie aus einem früheren Stand ohne Marke wäre ebenso veraltet
      await wipeLocal()
      localStorage.setItem(KEY, info.datenstand)
    }
  } catch {
    /* ohne localStorage: kein Vergleich möglich */
  }
  return info
}

/** «2026-11-10T09:05:00+01:00 …» → «10.11.2026, 09:05» */
export function datenstandText(d: string | null): string | null {
  const t = d ? new Date(d.split(' ')[0]) : null
  return t && !Number.isNaN(t.getTime()) ? t.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null
}
