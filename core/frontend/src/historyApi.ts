import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL, getToken } from './auth'
import { errorText } from './toast'

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
  options: { limit?: number; before?: string; rowId?: string } = {},
): Promise<HistoryEntry[]> {
  const params = new URLSearchParams()
  if (options.limit) params.set('limit', String(options.limit))
  if (options.before) params.set('before', options.before)
  if (options.rowId) params.set('row_id', options.rowId)
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
export interface ServerHistory {
  entries: HistoryEntry[] | null
  loading: boolean
  error: string | null
  reload: () => void
  /** Ältere Einträge nachladen (vor dem ältesten bisher geladenen). */
  loadMore: () => void
  /** Der letzte Abruf war voll – es gibt vermutlich ältere Einträge. */
  hasMore: boolean
  loadingMore: boolean
  /** Fehler beim Nachladen (die bisherige Liste bleibt stehen). */
  moreError: string | null
}

/** Hängt ältere Einträge an, ohne Doppelte (gleiche id). */
export function appendOlder(current: HistoryEntry[], older: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set(current.map((e) => e.id))
  return [...current, ...older.filter((e) => !seen.has(e.id))]
}

export function useServerHistory(moduleKey: string, limit = 300): ServerHistory {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  // Abrufe einer älteren Runde (nach reload/Modulwechsel) verwerfen
  const round = useRef(0)

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    let active = true
    const mine = ++round.current
    setLoading(true)
    setMoreError(null)
    setLoadingMore(false)
    fetchHistory(moduleKey, { limit })
      .then((rows) => {
        if (!active || round.current !== mine) return
        setEntries(rows)
        setHasMore(rows.length >= limit)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!active || round.current !== mine) return
        setEntries(null)
        setHasMore(false)
        setError(errorText(err))
      })
      .finally(() => {
        if (active && round.current === mine) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [moduleKey, limit, attempt])

  const oldest = entries && entries.length > 0 ? entries[entries.length - 1].changed_at : null

  const loadMore = useCallback(() => {
    if (!oldest || loadingMore) return
    const mine = round.current
    setLoadingMore(true)
    setMoreError(null)
    // Der Server blättert über «changed_at < before» (kein OFFSET)
    fetchHistory(moduleKey, { limit, before: oldest })
      .then((rows) => {
        if (round.current !== mine) return
        setEntries((cur) => appendOlder(cur ?? [], rows))
        setHasMore(rows.length >= limit)
      })
      .catch((err: unknown) => {
        if (round.current === mine) setMoreError(errorText(err))
      })
      .finally(() => {
        if (round.current === mine) setLoadingMore(false)
      })
  }, [moduleKey, limit, oldest, loadingMore])

  return { entries, loading, error, reload, loadMore, hasMore, loadingMore, moreError }
}
