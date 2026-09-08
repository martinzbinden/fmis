import { useCallback, useEffect, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '../db/DbContext'
import { subscribeDataChanged } from '../db/write'

/**
 * Führt eine pglite-Abfrage aus und lädt automatisch neu, wenn irgendwo in der
 * App über upsertRow()/softDeleteRow() geschrieben wurde oder ein Sync-Pull
 * neue Daten gebracht hat. Ersetzt Live-Queries für diese App-Grösse.
 */
export function useQuery<T>(
  queryFn: (db: PGlite) => Promise<T>,
  deps: unknown[] = [],
): { data: T | undefined; loading: boolean; refresh: () => void } {
  const db = useDb()
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const queryFnRef = useRef(queryFn)
  queryFnRef.current = queryFn
  // Bei schnell aufeinanderfolgenden Schreibvorgängen (z.B. Massenimport) können
  // mehrere refresh()-Aufrufe überlappend in Flight sein und in beliebiger
  // Reihenfolge auflösen. requestIdRef stellt sicher, dass nur die Antwort des
  // zuletzt GESTARTETEN Requests den State setzt, egal wann sie zurückkommt.
  const requestIdRef = useRef(0)

  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    queryFnRef
      .current(db)
      .then((result) => {
        if (requestIdRef.current === requestId) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error('Query fehlgeschlagen', err)
        if (requestIdRef.current === requestId) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, ...deps])

  useEffect(() => {
    refresh()
    const unsubscribe = subscribeDataChanged(() => refresh())
    return () => {
      // Invalidiert alle noch offenen Requests dieser Hook-Instanz, damit nach
      // Unmount/Re-Effect keine späte Antwort mehr auf einen State schreibt.
      requestIdRef.current++
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  return { data, loading, refresh }
}
