import { createWriter } from '@fmis/core/writer'
import { getDb } from './pglite'
import { SYNC_TABLES } from './tables'

// Simpler Pub/Sub, damit Seiten nach lokalen Schreibungen oder einem Pull neu
// laden können, ohne auf pglite Live-Queries angewiesen zu sein. Gemeinsames
// Window-Event für Wiesenjournal, Betrieb und Bau: deren Seiten zeigen auch
// Daten der jeweils anderen (Spuren im Journal, Parzellen im Arbeitsplan …).
const DATA_EVENT = 'fmis:betriebsdaten-changed'
let notifyTimer: ReturnType<typeof setTimeout> | null = null
export function notifyDataChanged(): void {
  if (notifyTimer) clearTimeout(notifyTimer)
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    window.dispatchEvent(new Event(DATA_EVENT))
  }, 150)
}
export function subscribeDataChanged(listener: () => void): () => void {
  window.addEventListener(DATA_EVENT, listener)
  return () => window.removeEventListener(DATA_EVENT, listener)
}

// Schreibweg samt Outbox, Verlauf, Rückgängig und Sync: core/frontend/src/writer.ts
const writer = createWriter({ getDb, tables: SYNC_TABLES, notifyDataChanged })
export { ensureOutbox } from '@fmis/core/writer'
export const { upsertRow, upsertRows, softDeleteRow, writeBatch, restoreRowState } = writer
