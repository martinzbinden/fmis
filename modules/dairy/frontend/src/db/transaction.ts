import type { PGlite, Transaction } from '@electric-sql/pglite'
import type { UndoChange } from '@fmis/core/undo'

const ROOT = Symbol('root')
const UNDO_BUFFER = Symbol('undoBuffer')

type TxClient = PGlite & { [ROOT]: PGlite; [UNDO_BUFFER]: UndoChange[] }

/**
 * Führt mehrere Schreibvorgänge in EINER Transaktion aus. Ohne sie läuft jede
 * Abfrage von upsertRow als eigene Transaktion samt IndexedDB-Flush — beim
 * Speichern einer Geburt (gut zwanzig Abfragen) waren das Sekunden, beim
 * Herdebuch-Import Minuten. Dazu atomar: bricht etwas ab, bleibt der alte
 * Stand. Der Callback bekommt die Transaktion als PGlite, damit upsertRow &
 * Co. unverändert darin schreiben können.
 *
 * Für «Rückgängig» sammelt die Transaktion die Änderungen und meldet sie erst
 * nach dem Commit (onTransactionCommit) — ein Abbruch hinterlässt keinen Schritt.
 */
export async function inTransaction<T>(pg: PGlite, fn: (tx: PGlite) => Promise<T>): Promise<T> {
  let buffer: UndoChange[] = []
  const result = await pg.transaction((tx) => {
    const client = asPglite(tx, rootOf(pg))
    buffer = client[UNDO_BUFFER]
    return fn(client)
  })
  if (buffer.length > 0) {
    // verschachtelt: an die äussere Transaktion weiterreichen
    const outer = undoBufferOf(pg)
    if (outer) outer.push(...buffer)
    else commitHandler?.(rootOf(pg), buffer)
  }
  return result
}

let commitHandler: ((root: PGlite, changes: UndoChange[]) => void) | undefined
/** write.ts meldet hier, wohin Änderungen nach dem Commit gehen (core/undo.ts). */
export function onTransactionCommit(handler: (root: PGlite, changes: UndoChange[]) => void): void {
  commitHandler = handler
}

/** Die eigentliche Datenbank hinter einem Transaktions-Client. */
export function rootOf(pg: PGlite): PGlite {
  return (pg as Partial<TxClient>)[ROOT] ?? pg
}

/** Sammelliste einer laufenden inTransaction, sonst undefined. */
export function undoBufferOf(pg: PGlite): UndoChange[] | undefined {
  return (pg as Partial<TxClient>)[UNDO_BUFFER]
}

function asPglite(tx: Transaction, root: PGlite): TxClient {
  return {
    query: tx.query.bind(tx),
    exec: tx.exec.bind(tx),
    transaction: <T>(cb: (inner: Transaction) => Promise<T>) => cb(tx),
    [ROOT]: root,
    [UNDO_BUFFER]: [],
  } as unknown as TxClient
}
