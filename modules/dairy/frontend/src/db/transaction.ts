import type { PGlite, Transaction } from '@electric-sql/pglite'

/**
 * Führt mehrere Schreibvorgänge in EINER Transaktion aus. Ohne sie läuft jede
 * Abfrage von upsertRow als eigene Transaktion samt IndexedDB-Flush — beim
 * Speichern einer Geburt (gut zwanzig Abfragen) waren das Sekunden, beim
 * Herdebuch-Import Minuten. Dazu atomar: bricht etwas ab, bleibt der alte
 * Stand. Der Callback bekommt die Transaktion als PGlite, damit upsertRow &
 * Co. unverändert darin schreiben können.
 */
export function inTransaction<T>(pg: PGlite, fn: (tx: PGlite) => Promise<T>): Promise<T> {
  return pg.transaction((tx) => fn(asPglite(tx)))
}

function asPglite(tx: Transaction): PGlite {
  return {
    query: tx.query.bind(tx),
    exec: tx.exec.bind(tx),
    transaction: <T>(cb: (inner: Transaction) => Promise<T>) => cb(tx),
  } as unknown as PGlite
}
