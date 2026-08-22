import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './pglite'
import { SYNC_TABLES, type SyncTable } from './tables'

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

/**
 * Generischer Upsert-Helfer für alle 8 syncbaren Tabellen. Jede Schreiboperation
 * der App MUSS hierüber laufen (nicht direkt per SQL), damit die Sync-Outbox
 * konsistent bleibt. Stempelt updated_at immer auf "jetzt" (lokale Schreibungen
 * sind per Definition die aktuellste Version).
 */
export async function upsertRow<T extends SyncTable>(
  table: T,
  row: Partial<Record<(typeof SYNC_TABLES)[T][number], unknown>> & { id: string },
): Promise<void> {
  const pg = await ready()
  const columns = SYNC_TABLES[table] as readonly string[]
  const stamped: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() }

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
  await upsertRow(table, { ...rows[0], id, deleted_at: new Date().toISOString() } as never)
}
