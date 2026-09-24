import { useCallback, useEffect, useState } from 'react'
import { API_URL, getToken } from './auth'

export type HistoryAction = 'insert' | 'update' | 'delete'

export interface HistoryEntry {
  id: string
  table_name: string
  row_id: string
  action: HistoryAction
  changed_by: string | null
  changed_at: string
  snapshot: string
  // Der Server liefert alle Spalten aus SYNC_TABLES["data_history"] — auch
  // updated_at, das die Modul-Typen mitführen.
  updated_at: string
}

/**
 * Der Änderungsverlauf kommt vom Server, nicht aus pglite: Er ist die mit
 * Abstand grösste Tabelle (auf diesem Betrieb 13 von 15 MB) und wächst mit
 * jeder Änderung weiter, während man ihn selten und nur zum Nachschauen
 * braucht. Der Client schreibt seine eigenen Einträge weiterhin lokal und
 * schiebt sie hoch — nur heruntergezogen wird nichts mehr (siehe
 * backend/app/sync.py der Module: pull() überspringt data_history).
 */
export async function fetchHistory(
  moduleKey: string,
  options: { limit?: number; before?: string } = {},
): Promise<HistoryEntry[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.before) params.set('before', options.before)
  const query = params.toString()
  const res = await fetch(`${API_URL}/${moduleKey}/sync/history${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    throw new Error(`Verlauf konnte nicht geladen werden (${res.status})`)
  }
  const body = (await res.json()) as { entries: HistoryEntry[] }
  return body.entries
}

/**
 * Lade-Zustand für die Verlaufsseiten. Anders als useQuery() (pglite) muss
 * hier ein Fehler sichtbar werden: ohne Verbindung gibt es schlicht keinen
 * Verlauf, und eine leere Liste ohne Erklärung sähe aus, als wäre nie etwas
 * geändert worden.
 */
export function useServerHistory(
  moduleKey: string,
  limit = 300,
): { entries: HistoryEntry[] | null; loading: boolean; error: string | null; reload: () => void } {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchHistory(moduleKey, { limit })
      .then((rows) => {
        if (!active) return
        setEntries(rows)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!active) return
        setEntries(null)
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [moduleKey, limit, attempt])

  return { entries, loading, error, reload }
}
