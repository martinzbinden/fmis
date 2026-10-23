import type { PGlite } from '@electric-sql/pglite'
import { API_URL, getToken, logout } from './auth'
import { clearSent, describeRejected, readOutbox, revertRejected, type RejectedRow } from './outbox'

export type SyncStatus = 'offline' | 'synced' | 'syncing' | 'error'

export interface SyncClient {
  /** Gibt die vom Server abgelehnten Zeilen zurück (bleiben in der Outbox). */
  push(): Promise<RejectedRow[]>
  pull(): Promise<void>
  syncNow(): Promise<void>
  startSyncLoop(): void
  subscribeSyncStatus(listener: () => void): () => void
  getSyncStatus(): SyncStatus
  getSyncError(): string | null
  /** Anzahl noch nicht an den Server gesendeter Einträge (ohne Verlauf). */
  getPendingCount(): number
  /** Zähler neu aus der Outbox lesen (meldet sich nur bei Änderung). */
  refreshPending(): Promise<void>
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Abgelaufenes oder entzogenes Token am eigenen Backend (fmis-api liegt
 * bewusst NICHT hinter Authelia, siehe core/backend/fmis_core/auth.py) wird
 * hier bislang nirgends erkannt: push()/pull() werfen bei jedem Fehlschlag
 * denselben generischen Error, syncNow() faengt ihn als stillen
 * Sync-Status "error" ab (SyncStatusDot) — ohne jemals zur Anmeldung
 * zurueckzufuehren. Bei einem 60-Sekunden-Takt scheitert das nach
 * Tokenablauf endlos leise, bis jemand von Hand neu laedt. Analog zu
 * fetchModules()' eigener 401-Behandlung in modulesApi.ts, nur hier per
 * echtem Neuladen statt React-State: dieser Code liegt ausserhalb des
 * Komponentenbaums und hat kein onLoggedOut() zur Hand.
 */
function handleUnauthorized(res: Response): void {
  if (res.status === 401) {
    logout()
    window.location.reload()
  }
}

const UNREACHABLE = 'Server nicht erreichbar — Änderungen bleiben auf dem Gerät und werden später gesendet.'

/** Verständlicher Text zu einer Fehlerantwort. 404/405/5xx heisst fast immer:
 * das Backend antwortet nicht (z.B. fängt der Webserver die Anfrage ab). */
function failureText(what: 'Push' | 'Pull', status: number): string {
  return [404, 405, 502, 503, 504].includes(status) ? UNREACHABLE : `${what} fehlgeschlagen (${status})`
}

function formatValue(value: unknown, dateOnly: boolean): unknown {
  if (value instanceof Date) {
    const iso = value.toISOString()
    return dateOnly ? iso.slice(0, 10) : iso
  }
  return value
}

/**
 * Baut einen eigenständigen Sync-Client für EIN Modul: eigene
 * Outbox/since-Verfolgung, eigener Backend-Pfadpräfix (/<moduleKey>/sync/*,
 * siehe backend/app/main.py), eigener Sync-Status. Jedes Modul ruft dies
 * einmal in seinem db/sync.ts auf (siehe modules/<name>/frontend/src/db/sync.ts)
 * — entspricht 1:1 der Logik, die vor dem Merge in jedem Modul eigenständig
 * dupliziert war, nur parametrisiert statt hart codiert.
 */
export function createSyncClient(
  moduleKey: string,
  syncTables: Record<string, readonly string[]>,
  dateOnlyColumns: Record<string, ReadonlySet<string>>,
  getDb: () => Promise<PGlite>,
  ensureOutbox: (pg: PGlite) => Promise<void>,
  notifyDataChanged: () => void,
): SyncClient {
  const sinceKey = `${moduleKey}_sync_since`
  // Signatur der Spaltenlisten: kommt mit einem App-Update eine neue Spalte
  // dazu (z.B. animals.lauf_nr), wären bereits gepullte Zeilen lokal ohne
  // diesen Wert und würden wegen `since` nie nachgeholt — deshalb bei
  // geänderter Signatur einmal komplett neu pullen.
  const schemaKey = `${moduleKey}_sync_schema`
  // "shared-db-v1": Modul-Instanzen teilen sich seither EINE pglite-Datenbank
  // (ein Postgres-Schema je Instanz statt vorher je einer eigenen IndexedDB,
  // siehe core/frontend/src/db.ts) — jedes Gerät startet dadurch mit leeren
  // neuen Schemas. Der Präfix zwingt genau EINMAL einen Voll-Pull, damit
  // schon synchronisierte Daten sofort wieder da sind (nicht erst nach der
  // nächsten inhaltlichen Schema-Änderung). Noch nicht hochgeladene lokale
  // Änderungen holt getModuleDb() separat aus der alten Datenbank.
  // "synced-at-v2" (2026-10-03): der Pull filtert seither auf die
  // Server-Ankunftszeit (core/backend/fmis_core/sync_stamps.py) statt auf
  // die Gerätezeit — Zeilen, die vorher wegen eines schon weitergerückten
  // `since` verpasst wurden (K03-Import), holt dieser eine Voll-Pull nach.
  const schemaSignature =
    'shared-db-v1:synced-at-v2:' + JSON.stringify(Object.entries(syncTables).map(([t, cols]) => [t, [...cols]]))
  try {
    if (localStorage.getItem(schemaKey) !== schemaSignature) {
      localStorage.removeItem(sinceKey)
      localStorage.setItem(schemaKey, schemaSignature)
    }
  } catch {
    // ohne localStorage: jeder Start ist ohnehin ein Voll-Pull
  }
  const base = `${API_URL}/${moduleKey}/sync`

  let status: SyncStatus = navigator.onLine ? 'synced' : 'offline'
  let lastError: string | null = null
  let pending = 0
  const listeners = new Set<() => void>()

  function setStatus(next: SyncStatus, error?: string) {
    status = next
    lastError = error ?? null
    listeners.forEach((l) => l())
  }

  /** Offene Einträge zählen; der Verlauf (data_history) zählt nicht mit — er
   * entsteht als Nebeneffekt jeder Änderung und sagt nichts über offene Daten. */
  async function refreshPending(): Promise<void> {
    try {
      const pg = await getDb()
      await ensureOutbox(pg)
      const { rows } = await pg.query<{ n: number }>(
        `select count(*)::int as n from sync_outbox where table_name <> 'data_history'`,
      )
      const next = rows[0]?.n ?? 0
      if (next !== pending) {
        pending = next
        listeners.forEach((l) => l())
      }
    } catch {
      // Zähler ist nur Anzeige
    }
  }

  function subscribeSyncStatus(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Sendet alle noch nicht gesyncten lokalen Änderungen an POST /<module>/sync/push.
   * Der Server quittiert zeilenweise: akzeptierte Zeilen verlassen die Outbox,
   * abgelehnte bleiben (und werden zurückgemeldet), ohne den Rest zu blockieren. */
  async function push(): Promise<RejectedRow[]> {
    const pg = await getDb()
    await ensureOutbox(pg)

    const outbox = await readOutbox(pg)
    if (outbox.length === 0) return []

    const byTable = new Map<string, string[]>()
    for (const r of outbox) {
      const list = byTable.get(r.table) ?? []
      list.push(r.id)
      byTable.set(r.table, list)
    }

    // In der Reihenfolge der Tabellenliste (Eltern vor Kindern): der Server
    // prüft Fremdschlüssel zeilenweise sofort.
    const payload: Record<string, Record<string, unknown>[]> = {}
    for (const table of Object.keys(syncTables)) {
      const ids = byTable.get(table)
      const columns = syncTables[table]
      if (!ids || !columns) continue
      const dateOnly = dateOnlyColumns[table]
      const colList = columns.map((c) => `"${c}"`).join(', ')
      const { rows } = await pg.query<Record<string, unknown>>(
        `select ${colList} from "${table}" where id = any($1::uuid[])`,
        [ids],
      )
      payload[table] = rows.map((row) => {
        const out: Record<string, unknown> = {}
        for (const c of columns) out[c] = formatValue(row[c], dateOnly.has(c))
        return out
      })
    }

    const res = await fetch(`${base}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ tables: payload }),
    })
    if (!res.ok) {
      handleUnauthorized(res)
      throw new Error(failureText('Push', res.status))
    }
    // Nur eine echte Push-Antwort (JSON mit "accepted") gilt als Quittung. Eine
    // «erfolgreiche» Antwort anderer Herkunft (z.B. die HTML-Startseite, wenn
    // das Backend fehlt) darf die Outbox NIE leeren.
    const body = (await res.json().catch(() => null)) as { accepted?: unknown; rejected?: RejectedRow[] } | null
    if (!body || typeof body.accepted !== 'object' || body.accepted === null) throw new Error(UNREACHABLE)
    // Ältere Server kennen "rejected" nicht → alles gilt als angenommen.
    const rejected = body.rejected ?? []

    // Nur genau die gesendeten Stände quittieren (siehe outbox.ts)
    // (Zeilen unbekannter Tabellen wurden nicht gesendet und bleiben stehen.)
    await clearSent(pg, outbox.filter((e) => syncTables[e.table]), rejected)
    // Nach Ablauf der Korrekturfrist abgelehnt: Änderung auf dem Gerät zurücknehmen
    if (await revertRejected(pg, rejected, syncTables).then((r) => r.length > 0)) notifyDataChanged()
    return rejected
  }

  /** Holt alle serverseitigen Änderungen seit dem letzten Sync (GET /<module>/sync/pull) und wendet sie per Last-Write-Wins lokal an. */
  async function pull(): Promise<void> {
    const pg = await getDb()
    const since = localStorage.getItem(sinceKey)

    // Zweiter Parameter (base) nötig: API_URL ist in Produktion bewusst leer
    // (same-origin), und new URL() akzeptiert relative Strings nur mit base.
    const url = new URL(`${base}/pull`, window.location.origin)
    if (since) url.searchParams.set('since', since)

    const res = await fetch(url.toString(), { headers: authHeaders() })
    if (!res.ok) {
      handleUnauthorized(res)
      throw new Error(failureText('Pull', res.status))
    }
    const data = (await res.json().catch(() => null)) as {
      server_time: string
      tables: Record<string, Record<string, unknown>[]>
    } | null
    if (!data || typeof data.server_time !== 'string' || !data.tables) throw new Error(UNREACHABLE)

    // Alles in EINER Transaktion: ausserhalb einer Transaktion committet
    // pglite jede Query einzeln nach IndexedDB — bei einem Erst-Pull mit
    // tausenden Zeilen (z.B. data_history nach einem Import) dauert das
    // Minuten und wird von jedem Seiten-Reload wieder abgebrochen.
    await pg.transaction(async (tx) => {
      for (const [table, columns] of Object.entries(syncTables)) {
        const rows = data.tables[table]
        if (!rows || rows.length === 0) continue
        const colList = columns.map((c) => `"${c}"`).join(', ')
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        const setClause = columns
          .filter((c) => c !== 'id')
          .map((c) => `"${c}" = excluded."${c}"`)
          .join(', ')
        for (const row of rows) {
          const values = columns.map((c) => row[c] ?? null)
          // Last-write-wins, identisch zum Backend-Push-Handler: nur übernehmen
          // wenn die Zeile lokal fehlt oder remote.updated_at neuer ist.
          await tx.query(
            `insert into "${table}" (${colList}) values (${placeholders})
             on conflict (id) do update set ${setClause}
             where "${table}".updated_at < excluded.updated_at`,
            values,
          )
        }
      }
    })

    localStorage.setItem(sinceKey, data.server_time)
    notifyDataChanged()
  }

  let syncing = false

  /** Führt push() gefolgt von pull() aus und aktualisiert den Sync-Status für die UI. */
  async function syncNow(): Promise<void> {
    if (!getToken()) return
    if (!navigator.onLine) {
      setStatus('offline')
      return
    }
    if (syncing) return
    syncing = true
    setStatus('syncing')
    try {
      const rejected = await push()
      await pull()
      if (rejected.length > 0) setStatus('error', describeRejected(rejected))
      else setStatus('synced')
    } catch (err) {
      console.error(`Sync fehlgeschlagen (${moduleKey})`, err)
      setStatus('error', err instanceof Error ? err.message : String(err))
    } finally {
      syncing = false
      void refreshPending()
    }
  }

  let loopStarted = false

  /** Startet den automatischen Sync-Loop: bei App-Start, alle 60s, und bei online-Event. */
  function startSyncLoop(): void {
    if (loopStarted) return
    loopStarted = true

    window.addEventListener('online', () => {
      setStatus('syncing')
      void syncNow()
    })
    window.addEventListener('offline', () => setStatus('offline'))

    void syncNow()
    setInterval(() => void syncNow(), 60_000)
  }

  return {
    push,
    pull,
    syncNow,
    startSyncLoop,
    subscribeSyncStatus,
    getSyncStatus: () => status,
    getSyncError: () => lastError,
    getPendingCount: () => pending,
    refreshPending,
  }
}
