import { getDb } from './pglite'
import { ensureOutbox, notifyDataChanged } from './write'
import { SYNC_TABLES, DATE_ONLY_COLUMNS, type SyncTable } from './tables'
import { API_URL, getToken } from './auth'

const SINCE_KEY = 'dairy_sync_since'

export type SyncStatus = 'offline' | 'synced' | 'syncing' | 'error'

let status: SyncStatus = navigator.onLine ? 'synced' : 'offline'
let lastError: string | null = null
const listeners = new Set<() => void>()

function setStatus(next: SyncStatus, error?: string) {
  status = next
  lastError = error ?? null
  listeners.forEach((l) => l())
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSyncStatus(): SyncStatus {
  return status
}

export function getSyncError(): string | null {
  return lastError
}

function formatValue(value: unknown, dateOnly: boolean): unknown {
  if (value instanceof Date) {
    const iso = value.toISOString()
    return dateOnly ? iso.slice(0, 10) : iso
  }
  return value
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Sendet alle noch nicht gesyncten lokalen Änderungen an POST /sync/push. */
export async function push(): Promise<void> {
  const pg = await getDb()
  await ensureOutbox(pg)

  const { rows: outboxRows } = await pg.query<{ table_name: SyncTable; row_id: string }>(
    'select table_name, row_id from sync_outbox',
  )
  if (outboxRows.length === 0) return

  const byTable = new Map<SyncTable, string[]>()
  for (const r of outboxRows) {
    const list = byTable.get(r.table_name) ?? []
    list.push(r.row_id)
    byTable.set(r.table_name, list)
  }

  const payload: Record<string, Record<string, unknown>[]> = {}
  for (const [table, ids] of byTable) {
    const columns = SYNC_TABLES[table] as readonly string[]
    const dateOnly = DATE_ONLY_COLUMNS[table]
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

  const res = await fetch(`${API_URL}/sync/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ tables: payload }),
  })
  if (!res.ok) {
    throw new Error(`Push fehlgeschlagen (${res.status})`)
  }

  // Outbox nur für die tatsächlich gesendeten Zeilen leeren.
  for (const [table, ids] of byTable) {
    await pg.query(
      'delete from sync_outbox where table_name = $1 and row_id = any($2::uuid[])',
      [table, ids],
    )
  }
}

/** Holt alle serverseitigen Änderungen seit dem letzten Sync (GET /sync/pull) und wendet sie per Last-Write-Wins lokal an. */
export async function pull(): Promise<void> {
  const pg = await getDb()
  const since = localStorage.getItem(SINCE_KEY)

  // Zweiter Parameter (base) nötig: API_URL ist in Produktion bewusst leer
  // (same-origin), und new URL() akzeptiert relative Strings nur mit base.
  const url = new URL(`${API_URL}/sync/pull`, window.location.origin)
  if (since) url.searchParams.set('since', since)

  const res = await fetch(url.toString(), { headers: authHeaders() })
  if (!res.ok) {
    throw new Error(`Pull fehlgeschlagen (${res.status})`)
  }
  const data = (await res.json()) as {
    server_time: string
    tables: Record<string, Record<string, unknown>[]>
  }

  for (const [table, columns] of Object.entries(SYNC_TABLES)) {
    const rows = data.tables[table]
    if (!rows || rows.length === 0) continue
    const cols = columns as readonly string[]
    const colList = cols.map((c) => `"${c}"`).join(', ')
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
    const setClause = cols
      .filter((c) => c !== 'id')
      .map((c) => `"${c}" = excluded."${c}"`)
      .join(', ')
    for (const row of rows) {
      const values = cols.map((c) => row[c] ?? null)
      // Last-write-wins, identisch zum Backend-Push-Handler: nur übernehmen
      // wenn die Zeile lokal fehlt oder remote.updated_at neuer ist.
      await pg.query(
        `insert into "${table}" (${colList}) values (${placeholders})
         on conflict (id) do update set ${setClause}
         where "${table}".updated_at < excluded.updated_at`,
        values,
      )
    }
  }

  localStorage.setItem(SINCE_KEY, data.server_time)
  notifyDataChanged()
}

let syncing = false

/** Führt push() gefolgt von pull() aus und aktualisiert den Sync-Status für die UI. */
export async function syncNow(): Promise<void> {
  if (!getToken()) return
  if (!navigator.onLine) {
    setStatus('offline')
    return
  }
  if (syncing) return
  syncing = true
  setStatus('syncing')
  try {
    await push()
    await pull()
    setStatus('synced')
  } catch (err) {
    console.error('Sync fehlgeschlagen', err)
    setStatus('error', err instanceof Error ? err.message : String(err))
  } finally {
    syncing = false
  }
}

let loopStarted = false

/** Startet den automatischen Sync-Loop: bei App-Start, alle 60s, und bei online-Event. */
export function startSyncLoop(): void {
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
