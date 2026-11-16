// Schreibhelfer über dem Store (Namen wie zu pglite-Zeiten, damit die Aufrufer gleich bleiben).
import { db } from './db'
import type { Store, Table, TableTypes } from './store'

export type { Table }

export function upsertRow<K extends Table>(table: K, row: Partial<TableTypes[K]> & { id: string }, opts: { store?: Store } = {}): TableTypes[K] {
  return (opts.store ?? db()).put(table, row)
}

export function softDeleteRow(table: Table, id: string, opts: { store?: Store } = {}): void {
  ;(opts.store ?? db()).softDelete(table, id)
}

export function getSetting<T>(key: string, fallback: T, store?: Store): T {
  return (store ?? db()).getSetting(key, fallback)
}

export function setSetting(key: string, value: unknown, store?: Store): void {
  ;(store ?? db()).setSetting(key, value)
}
