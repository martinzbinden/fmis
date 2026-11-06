// Gemeinsamer Schreibweg der Module tiere, wiesenjournal, betrieb, livestock,
// fields und bau (vorher sechs fast gleiche Kopien in deren db/write.ts — ein
// Fix in einer Kopie erreichte die anderen nicht). Jede Schreiboperation der
// App MUSS hierüber laufen (nicht direkt per SQL), damit Outbox, Verlauf,
// «Rückgängig» und Sync zusammenpassen. dairy hat wegen seiner
// Transaktions-Clients (db/transaction.ts) einen eigenen, gleich aufgebauten Weg.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from './auth'
import { schemaOf } from './db'
import { scheduleSync } from './sync'
import { recordUndo, type UndoChange } from './undo'

type HistoryAction = 'insert' | 'update' | 'delete'
/** PGlite oder eine laufende Transaktion — beide haben query(). */
type Queryable = Pick<PGlite, 'query'>
type Tables = Record<string, readonly string[]>
type Row<S extends Tables, T extends keyof S> = Partial<Record<S[T][number], unknown>> & { id: string }

/** Schreiber innerhalb von writeBatch: alles darin ist EINE Transaktion. */
export interface BatchWriter<S extends Tables> {
  upsert<T extends keyof S & string>(table: T, row: Row<S, T>, options?: { action?: HistoryAction }): Promise<void>
  softDelete(table: keyof S & string, id: string): Promise<void>
}

/**
 * Legt die lokale Sync-Outbox an, falls sie noch nicht existiert.
 * NICHT Teil der schema/*.sql — reines Sync-Client-Implementierungsdetail,
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

/**
 * Schreibt einen Eintrag in data_history direkt per SQL (NICHT über
 * upsertRow — das würde rekursiv wieder einen History-Eintrag auslösen).
 */
async function recordHistory(pg: Queryable, table: string, rowId: string, action: HistoryAction, snapshot: Record<string, unknown>): Promise<void> {
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

export function createWriter<S extends Tables>(opts: { getDb: () => Promise<PGlite>; tables: S; notifyDataChanged: () => void ; withoutHistory?: Set<string> }) {
  const { getDb, tables, notifyDataChanged, withoutHistory } = opts

  let outboxReady: Promise<void> | null = null
  async function ready(): Promise<PGlite> {
    const pg = await getDb()
    if (!outboxReady) outboxReady = ensureOutbox(pg).then(() => pruneSyncedHistory(pg))
    await outboxReady
    return pg
  }

  /**
   * Upsert einer Zeile samt Outbox und Verlauf. Stempelt updated_at immer auf
   * "jetzt" (lokale Schreibungen sind per Definition die aktuellste Version).
   * Nicht übergebene Spalten behalten ihren bisherigen Wert — eine Teilzeile
   * { id, notes } löscht also nicht alle anderen Felder; wer eine Spalte
   * leeren will, übergibt ausdrücklich null.
   */
  async function writeRow(pg: Queryable, table: string, row: { id: string } & Record<string, unknown>, forcedAction?: HistoryAction): Promise<UndoChange | null> {
    const columns = tables[table] as readonly string[] | undefined
    if (!columns) throw new Error(`Unbekannte Tabelle ${table}`)

    // Stand davor: für den Verlauf (insert/update), «Rückgängig» und fehlende Spalten
    const { rows: existing } = await pg.query<Record<string, unknown>>(`select * from "${table}" where id = $1`, [row.id])
    const before = existing[0] ?? null
    const action = forcedAction ?? (before ? 'update' : 'insert')
    const stamped: Record<string, unknown> = { ...(before ?? {}), ...row, updated_at: new Date().toISOString() }

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

    // Guard gegen versehentliche Rekursion (recordHistory() umgeht writeRow).
    if (table === 'data_history') return null
    if (!withoutHistory?.has(table)) {
      const snapshot: Record<string, unknown> = {}
      for (const c of columns) snapshot[c] = stamped[c] ?? null
      await recordHistory(pg, table, row.id, action, snapshot)
    }
    return { table, id: row.id, kind: action, before }
  }

  async function deleteRow(pg: Queryable, table: string, id: string): Promise<UndoChange | null> {
    const { rows } = await pg.query<Record<string, unknown>>(`select * from "${table}" where id = $1`, [id])
    if (rows.length === 0) return null
    return writeRow(pg, table, { ...rows[0], id, deleted_at: new Date().toISOString() }, 'delete')
  }

  /** Nach dem Commit: an «Rückgängig» melden, Seiten neu laden lassen und bald
   * senden — nur für die Datenbank des Geräts, nicht für flüchtige Import-Sitzungen. */
  function afterCommit(pg: PGlite, changes: (UndoChange | null)[]): void {
    const source = schemaOf(pg)
    const done = changes.filter((c): c is UndoChange => c != null)
    if (source && done.length > 0) recordUndo(source, (cs) => restoreChanges(pg, cs), done)
    notifyDataChanged()
    if (done.length > 0) scheduleSync(source)
  }

  /** War die Zeile neu, wird sie gelöscht, sonst kommt der alte Stand zurück. */
  async function restoreChanges(pg: PGlite, changes: UndoChange[]): Promise<void> {
    await pg.transaction(async (tx) => {
      for (const c of changes) {
        if (c.before) {
          await writeRow(tx, c.table, { ...c.before, id: c.id })
          continue
        }
        const { rows } = await tx.query<Record<string, unknown>>(`select * from "${c.table}" where id = $1`, [c.id])
        if (rows[0] && !rows[0].deleted_at) await writeRow(tx, c.table, { ...rows[0], id: c.id, deleted_at: new Date().toISOString() }, 'delete')
      }
    })
    notifyDataChanged()
    scheduleSync(schemaOf(pg), 0)
  }

  /** Ohne explizites `options.action` wird per Existenz-Check zwischen insert/update unterschieden. */
  async function upsertRow<T extends keyof S & string>(
    table: T,
    row: Row<S, T>,
    options?: { action?: HistoryAction; /** andere Datenbank, z.B. Import-Sitzung (importSession.ts) */ pg?: PGlite },
  ): Promise<void> {
    const pg = options?.pg ?? (await ready())
    // EINE Transaktion: sonst schreibt pglite jede der fünf Queries einzeln nach IndexedDB
    const change = await pg.transaction((tx) => writeRow(tx, table, row as never, options?.action))
    afterCommit(pg, [change])
  }

  /** Mehrere Zeilen in EINER Transaktion — ausserhalb einer Transaktion
   * schreibt pglite jede Query einzeln nach IndexedDB (rund 1 s je Zeile mit
   * Outbox und Verlauf, z.B. beim Übernehmen ganzer Wartungspläne). */
  async function upsertRows<T extends keyof S & string>(table: T, rows: Row<S, T>[]): Promise<void> {
    if (rows.length === 0) return
    await writeBatch(async (w) => {
      for (const row of rows) await w.upsert(table, row)
    })
  }

  /** Soft-Delete: setzt deleted_at und stösst die Zeile erneut in die Outbox. */
  async function softDeleteRow(table: keyof S & string, id: string): Promise<void> {
    const pg = await ready()
    const change = await pg.transaction((tx) => deleteRow(tx, table, id))
    if (change) afterCommit(pg, [change])
  }

  /** Mehrere Schreibungen (auch verschiedene Tabellen) atomar: bricht etwas ab
   * oder wird die App geschlossen, bleibt der alte Stand. Ein Rückgängig-Schritt. */
  async function writeBatch<R>(fn: (w: BatchWriter<S>) => Promise<R>): Promise<R> {
    const pg = await ready()
    const changes: (UndoChange | null)[] = []
    const result = await pg.transaction(async (tx) => {
      const w: BatchWriter<S> = {
        upsert: async (table, row, options) => void changes.push(await writeRow(tx, table, row as never, options?.action)),
        softDelete: async (table, id) => void changes.push(await deleteRow(tx, table, id)),
      }
      return fn(w)
    })
    afterCommit(pg, changes)
    return result
  }

  /** Admins im Protokoll (HistoryUndoButton): eine Zeile auf einen früheren
   * Stand setzen; state = null löscht sie. Über den normalen Schreibweg, also
   * mit Verlauf und Sync — und in dieser Sitzung wieder rückgängig zu machen.
   * Gibt false zurück, wenn sich auf diesem Gerät nichts änderte (Zeile fehlt
   * oder ist schon gelöscht). */
  async function restoreRowState(table: string, id: string, state: Record<string, unknown> | null): Promise<boolean> {
    if (!(table in tables) || table === 'data_history') throw new Error(`Bereich ${table} lässt sich nicht zurücknehmen.`)
    const pg = await ready()
    const change = await pg.transaction(async (tx) => {
      const { rows } = await tx.query<Record<string, unknown>>(`select * from "${table}" where id = $1`, [id])
      const current = rows[0] ?? null
      if (state) return writeRow(tx, table, { ...state, id })
      if (current && !current.deleted_at) return writeRow(tx, table, { ...current, id, deleted_at: new Date().toISOString() }, 'delete')
      return null
    })
    if (!change) return false
    afterCommit(pg, [change])
    return true
  }

  return { ensureOutbox, upsertRow, upsertRows, softDeleteRow, writeBatch, restoreRowState }
}
