import { useCallback, useEffect, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { subscribeDataChanged } from '../db/write'

/**
 * Führt eine pglite-Abfrage aus und lädt automatisch neu, wenn irgendwo in der
 * App über upsertRow()/softDeleteRow() geschrieben wurde oder ein Sync-Pull
 * neue Daten gebracht hat.
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
      requestIdRef.current++
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  return { data, loading, refresh }
}
