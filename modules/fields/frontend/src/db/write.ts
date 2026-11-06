import { createWriter } from '@fmis/core/writer'
import { getDb } from './pglite'
import { SYNC_TABLES } from './tables'

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

// Schreibweg samt Outbox, Verlauf, Rückgängig und Sync: core/frontend/src/writer.ts
// Direktzahlungen ohne Verlauf: den Verlauf liest auch die Rolle Mitarbeit (fields:history)
const writer = createWriter({ getDb, tables: SYNC_TABLES, notifyDataChanged, withoutHistory: new Set(['dp_settings', 'dp_statement_lines']) })
export { ensureOutbox } from '@fmis/core/writer'
export const { upsertRow, upsertRows, softDeleteRow, writeBatch, restoreRowState } = writer
