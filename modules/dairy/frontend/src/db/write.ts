import type { PGlite } from '@electric-sql/pglite'
import { SYNC_TABLES, type SyncTable } from './tables'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { schemaOf } from '@fmis/core/db'
import { recordUndo, type UndoChange, type UndoRestore } from '@fmis/core/undo'
import { inTransaction, onTransactionCommit, undoBufferOf } from './transaction'

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
 * Der Verlauf wird nicht mehr heruntergezogen (siehe historyApi.ts), aber
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

// Pro pglite-Instanz (nicht global) gecacht — dieses Modul kann mehrfach
// instanziert werden (siehe module_registry.py, ModuleSpec.source), jede
// Instanz hat ihre eigene PGlite-Instanz und damit ihre eigene Outbox.
const outboxReadyByDb = new WeakMap<PGlite, Promise<void>>()
async function ready(pg: PGlite): Promise<PGlite> {
  let outboxReady = outboxReadyByDb.get(pg)
  if (!outboxReady) {
    outboxReady = ensureOutbox(pg).then(() => pruneSyncedHistory(pg))
    outboxReadyByDb.set(pg, outboxReady)
  }
  await outboxReady
  return pg
}

type HistoryAction = 'insert' | 'update' | 'delete'

/** PGlite oder eine laufende Transaktion — beide haben query(). */
type Queryable = Pick<PGlite, 'query'>
type RowOf<T extends SyncTable> = Partial<Record<(typeof SYNC_TABLES)[T][number], unknown>> & { id: string }

/**
 * Schreibt einen Eintrag in data_history direkt per SQL (NICHT über
 * upsertRow — das würde rekursiv wieder einen History-Eintrag auslösen).
 * Wird von writeRow() für jede Tabelle ausser data_history selbst
 * aufgerufen, siehe schema/0002_history.sql.
 */
async function recordHistory(
  pg: Queryable,
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
 *
 * Alles in EINER Transaktion: ausserhalb einer Transaktion schreibt pglite
 * jede Query einzeln nach IndexedDB — fünf Flushes je Zeile, rund 1 s am PC
 * und 2 s am Handy.
 */
export async function upsertRow<T extends SyncTable>(pg: PGlite, table: T, row: RowOf<T>, options?: { action?: HistoryAction }): Promise<void> {
  await ready(pg)
  await inTransaction(pg, (tx) => writeRow(tx, table, row, options?.action))
  notifyDataChanged()
}

/** Mehrere Zeilen in EINER Transaktion (ein Flush, ein Neuladen der Seiten),
 * z.B. ganze Tierlisten auf eine Merkliste. */
export async function upsertRows<T extends SyncTable>(pg: PGlite, table: T, rows: RowOf<T>[]): Promise<void> {
  if (rows.length === 0) return
  await ready(pg)
  await inTransaction(pg, async (tx) => {
    for (const row of rows) await writeRow(tx, table, row)
  })
  notifyDataChanged()
}

async function writeRow<T extends SyncTable>(pg: PGlite, table: T, row: RowOf<T>, forcedAction?: HistoryAction): Promise<void> {
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
  if (table !== 'data_history') {
    await recordHistory(pg, table, row.id, action, stamped)
    undoBufferOf(pg)?.push({ table, id: row.id, kind: action, before })
  }
}

/** Stellt die Stände vor einer Aktion wieder her (core/undo.ts): war die Zeile
 * neu, wird sie gelöscht, sonst kommt der alte Stand zurück. */
function restoreFor(root: PGlite): UndoRestore {
  return async (changes: UndoChange[]) => {
    await ready(root)
    await inTransaction(root, async (tx) => {
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
}

onTransactionCommit((root, changes) => recordUndo(schemaOf(root) ?? 'dairy', restoreFor(root), changes))

/** Soft-Delete: setzt deleted_at und stösst die Zeile erneut in die Outbox. */
export async function softDeleteRow(pg: PGlite, table: SyncTable, id: string): Promise<void> {
  await softDeleteRows(pg, table, [id])
}

/** Soft-Delete mehrerer Zeilen in EINER Transaktion. */
export async function softDeleteRows(pg: PGlite, table: SyncTable, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await ready(pg)
  let changed = false
  await inTransaction(pg, async (tx) => {
    for (const id of ids) {
      const { rows } = await tx.query<Record<string, unknown>>(`select * from "${table}" where id = $1`, [id])
      if (rows.length === 0) continue
      await writeRow(tx, table, { ...rows[0], id, deleted_at: new Date().toISOString() } as never, 'delete')
      changed = true
    }
  })
  if (changed) notifyDataChanged()
}


/** Admins im Protokoll (core/HistoryUndoButton): eine Zeile auf einen früheren
 * Stand setzen; state = null löscht sie. Über den normalen Schreibweg, also mit
 * Verlauf und Sync — und in dieser Sitzung wieder rückgängig zu machen. */
export async function restoreRowState(pg: PGlite, table: string, id: string, state: Record<string, unknown> | null): Promise<void> {
  if (!(table in SYNC_TABLES) || table === 'data_history') throw new Error(`Bereich ${table} lässt sich nicht zurücknehmen.`)
  const t = table as SyncTable
  await ready(pg)
  await inTransaction(pg, async (tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(`select * from "${t}" where id = $1`, [id])
    const current = rows[0] ?? null
    if (state) await writeRow(tx, t, { ...(current ?? {}), ...state, id } as never)
    else if (current && !current.deleted_at) await writeRow(tx, t, { ...current, id, deleted_at: new Date().toISOString() } as never, 'delete')
  })
  notifyDataChanged()
}
