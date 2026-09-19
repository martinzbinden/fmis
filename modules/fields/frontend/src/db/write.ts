import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './pglite'
import { SYNC_TABLES, type SyncTable } from './tables'
import { getCurrentUserEmail } from './auth'

// Simpler Pub/Sub, damit Seiten nach lokalen Schreibungen oder einem Pull neu
// laden können, ohne auf pglite Live-Queries angewiesen zu sein.
const dataListeners = new Set<() => void>()
// Bei Massenoperationen (z.B. Tierimport: ~2 Schreibungen pro Tier) debouncen,
// damit nicht nach jeder einzelnen Zeile alle Seiten neu abfragen — sonst
// wartet die UI bei 33 Tieren auf bis zu 67 sequentielle Requeries.
let notifyTimer: ReturnType<typeof setTimeout> | null = null
export function notifyDataChanged(): void {
  if (notifyTimer) clearTimeout(notifyTimer)
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    dataListeners.forEach((l) => l())
  }, 150)
}
export function subscribeDataChanged(listener: () => void): () => void {
  dataListeners.add(listener)
  return () => dataListeners.delete(listener)
}

/**
 * Legt die lokale Sync-Outbox an, falls sie noch nicht existiert.
 * NICHT Teil von schema/0001_init.sql — reines Sync-Client-Implementierungsdetail,
 * wird daher nicht über den Migration-Runner, sondern hier direkt verwaltet.
 */
export async function ensureOutbox(pg: PGlite): Promise<void> {
  await pg.exec(`
    create table if not exists sync_outbox (
      table_name text not null,
      row_id uuid not null,
      updated_at timestamptz not null default now(),
      primary key (table_name, row_id)
    )
  `)
}

let outboxReady: Promise<void> | null = null
async function ready(): Promise<PGlite> {
  const pg = await getDb()
  if (!outboxReady) outboxReady = ensureOutbox(pg)
  await outboxReady
  return pg
}

type HistoryAction = 'insert' | 'update' | 'delete'

/**
 * Schreibt einen Eintrag in data_history direkt per SQL (NICHT über
 * upsertRow — das würde rekursiv wieder einen History-Eintrag auslösen).
 * Wird von upsertRow() für jede Tabelle ausser data_history selbst
 * aufgerufen, siehe schema/0002_history.sql.
 */
async function recordHistory(
  pg: PGlite,
  table: SyncTable,
  rowId: string,
  action: HistoryAction,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const id = crypto.randomUUID()
  const changedAt = new Date().toISOString()
  await pg.query(
    `insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, table, rowId, action, getCurrentUserEmail(), changedAt, JSON.stringify(snapshot), changedAt],
  )
  await pg.query(
    `insert into sync_outbox (table_name, row_id, updated_at) values ($1, $2, $3)
     on conflict (table_name, row_id) do update set updated_at = excluded.updated_at`,
    ['data_history', id, changedAt],
  )
}

/**
 * Generischer Upsert-Helfer für alle syncbaren Tabellen. Jede Schreiboperation
 * der App MUSS hierüber laufen (nicht direkt per SQL), damit die Sync-Outbox
 * konsistent bleibt. Stempelt updated_at immer auf "jetzt" (lokale Schreibungen
 * sind per Definition die aktuellste Version). Schreibt ausserdem automatisch
 * einen data_history-Eintrag (siehe recordHistory) — ohne explizites
 * `options.action` wird per Existenz-Check zwischen insert/update unterschieden.
 */
export async function upsertRow<T extends SyncTable>(
  table: T,
  row: Partial<Record<(typeof SYNC_TABLES)[T][number], unknown>> & { id: string },
  options?: { action?: HistoryAction },
): Promise<void> {
  const pg = await ready()
  const columns = SYNC_TABLES[table] as readonly string[]
  const stamped: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() }

  let action = options?.action
  if (!action) {
    const { rows: existing } = await pg.query(`select 1 from "${table}" where id = $1`, [row.id])
    action = existing.length > 0 ? 'update' : 'insert'
  }

  const colList = columns.map((c) => `"${c}"`).join(', ')
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
  const setClause = columns
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = excluded."${c}"`)
    .join(', ')
  const values = columns.map((c) => stamped[c] ?? null)

  await pg.query(
    `insert into "${table}" (${colList}) values (${placeholders})
     on conflict (id) do update set ${setClause}`,
    values,
  )

  await pg.query(
    `insert into sync_outbox (table_name, row_id, updated_at) values ($1, $2, $3)
     on conflict (table_name, row_id) do update set updated_at = excluded.updated_at`,
    [table, row.id, stamped.updated_at],
  )

  // Guard gegen versehentliche Rekursion, falls table_name mal 'data_history'
  // wäre (kommt im normalen Betrieb nie vor, recordHistory() umgeht upsertRow).
  if (table !== 'data_history') {
    await recordHistory(pg, table, row.id, action, stamped)
  }

  notifyDataChanged()
}

/** Soft-Delete: setzt deleted_at und stösst die Zeile via upsertRow erneut in die Outbox. */
export async function softDeleteRow(table: SyncTable, id: string): Promise<void> {
  const pg = await ready()
  const { rows } = await pg.query<Record<string, unknown>>(
    `select * from "${table}" where id = $1`,
    [id],
  )
  if (rows.length === 0) return
  await upsertRow(
    table,
    { ...rows[0], id, deleted_at: new Date().toISOString() } as never,
    { action: 'delete' },
  )
}
