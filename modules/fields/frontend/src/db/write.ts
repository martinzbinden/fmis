import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './pglite'
import { SYNC_TABLES, type SyncTable } from './tables'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { schemaOf } from '@fmis/core/db'
import { recordUndo, type UndoChange } from '@fmis/core/undo'

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

/**
 * Wirft lokale Verlaufszeilen weg, die bereits beim Server sind.
 *
 * Der Verlauf wird nicht mehr heruntergezogen (siehe core historyApi.ts), aber
 * Geräte, die vorher liefen, tragen ihn noch mit sich herum — auf diesem
 * Betrieb waren das 13 von 15 MB. Was noch in der Outbox steht, ist NICHT
 * hochgeschoben und bleibt deshalb liegen; alles andere lässt sich gefahrlos
 * löschen, weil es auf dem Server vollständig vorliegt und die Seite
 * "Verlauf" es von dort liest.
 */
async function pruneSyncedHistory(pg: PGlite): Promise<void> {
  await pg.query(
    `delete from data_history
     where id not in (select row_id from sync_outbox where table_name = 'data_history')`,
  )
}

let outboxReady: Promise<void> | null = null
async function ready(): Promise<PGlite> {
  const pg = await getDb()
  if (!outboxReady) outboxReady = ensureOutbox(pg).then(() => pruneSyncedHistory(pg))
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
  pg: Pick<PGlite, 'query'>,
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
  options?: { action?: HistoryAction; /** andere Datenbank, z.B. Import-Sitzung (core/frontend/src/importSession.ts) */ pg?: PGlite },
): Promise<void> {
  const pg = options?.pg ?? (await ready())
  // EINE Transaktion: sonst schreibt pglite jede der fünf Queries einzeln nach IndexedDB
  const change = await pg.transaction((tx) => writeRow(tx, table, row, options?.action))
  reportUndo(pg, [change])
  notifyDataChanged()
}

async function writeRow<T extends SyncTable>(
  pg: Pick<PGlite, 'query'>,
  table: T,
  row: Partial<Record<(typeof SYNC_TABLES)[T][number], unknown>> & { id: string },
  forcedAction?: HistoryAction,
): Promise<UndoChange | null> {
  const columns = SYNC_TABLES[table] as readonly string[]
  const stamped: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() }

  // Stand davor: für den Verlauf (insert/update) und für «Rückgängig»
  const { rows: existing } = await pg.query<Record<string, unknown>>(`select * from "${table}" where id = $1`, [row.id])
  const before = existing[0] ?? null
  const action = forcedAction ?? (before ? 'update' : 'insert')

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
  if (table === 'data_history') return null
  await recordHistory(pg, table, row.id, action, stamped)
  return { table, id: row.id, kind: action, before }
}

/** Nach dem Commit an «Rückgängig» melden (core/undo.ts) — nur für die Datenbank
 * des Geräts, nicht für flüchtige Import-Sitzungen. */
function reportUndo(pg: PGlite, changes: (UndoChange | null)[]): void {
  const source = schemaOf(pg)
  const done = changes.filter((c): c is UndoChange => c != null)
  if (source && done.length > 0) recordUndo(source, (cs) => restoreChanges(pg, cs), done)
}

/** War die Zeile neu, wird sie gelöscht, sonst kommt der alte Stand zurück. */
async function restoreChanges(pg: PGlite, changes: UndoChange[]): Promise<void> {
  await pg.transaction(async (tx) => {
    for (const c of changes) {
      const table = c.table as SyncTable
      if (c.before) {
        await writeRow(tx, table, { ...c.before, id: c.id } as never)
        continue
      }
      const { rows } = await tx.query<Record<string, unknown>>(`select * from "${table}" where id = $1`, [c.id])
      if (rows[0] && !rows[0].deleted_at) await writeRow(tx, table, { ...rows[0], id: c.id, deleted_at: new Date().toISOString() } as never, 'delete')
    }
  })
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


/** Admins im Protokoll (core/HistoryUndoButton): eine Zeile auf einen früheren
 * Stand setzen; state = null löscht sie. Über den normalen Schreibweg, also mit
 * Verlauf und Sync — und in dieser Sitzung wieder rückgängig zu machen. */
export async function restoreRowState(table: string, id: string, state: Record<string, unknown> | null): Promise<void> {
  if (!(table in SYNC_TABLES) || table === 'data_history') throw new Error(`Bereich ${table} lässt sich nicht zurücknehmen.`)
  const t = table as SyncTable
  const pg = await ready()
  const change = await pg.transaction(async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(`select * from "${t}" where id = $1`, [id])
    const current = rows[0] ?? null
    if (state) return writeRow(tx, t, { ...(current ?? {}), ...state, id } as never)
    if (current && !current.deleted_at) return writeRow(tx, t, { ...current, id, deleted_at: new Date().toISOString() } as never, 'delete')
    return null
  })
  reportUndo(pg, [change])
  notifyDataChanged()
}
