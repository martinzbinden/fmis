import { useCallback, useEffect, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from './DbContext'
import { errorText, notifyError } from './toast'

/**
 * Gemeinsamer Abfrage-Hook aller Module (vorher je Modul eine Kopie): führt
 * eine pglite-Abfrage aus und lädt automatisch neu, wenn irgendwo in der App
 * über upsertRow()/softDeleteRow() geschrieben wurde oder ein Sync-Pull neue
 * Daten gebracht hat (`subscribe` = db/write.ts des Moduls).
 *
 * Scheitert die Abfrage, steht der Fehler in `error` UND erscheint als
 * Hinweis — früher stand er nur in der Konsole, die Seite blieb leer und
 * wirkte wie verlorene Daten.
 */
export interface QueryResult<T> {
  data: T | undefined
  loading: boolean
  error: string | null
  refresh: () => void
}

export function createUseQuery(subscribe: (listener: () => void) => () => void) {
  return function useQuery<T>(queryFn: (db: PGlite) => Promise<T>, deps: unknown[] = []): QueryResult<T> {
    const db = useDb()
    const [data, setData] = useState<T | undefined>(undefined)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const queryFnRef = useRef(queryFn)
    queryFnRef.current = queryFn
    // Bei schnell aufeinanderfolgenden Schreibvorgängen (z.B. Massenimport)
    // können mehrere refresh()-Aufrufe überlappend laufen und in beliebiger
    // Reihenfolge antworten: nur die Antwort des zuletzt GESTARTETEN Aufrufs
    // setzt den State.
    const requestIdRef = useRef(0)

    const refresh = useCallback(() => {
      const requestId = ++requestIdRef.current
      setLoading(true)
      queryFnRef
        .current(db)
        .then((result) => {
          if (requestIdRef.current === requestId) {
            setData(result)
            setError(null)
            setLoading(false)
          }
        })
        .catch((err) => {
          console.error('Query fehlgeschlagen', err)
          if (requestIdRef.current === requestId) {
            setError(errorText(err))
            setLoading(false)
            notifyError(`Daten konnten nicht geladen werden: ${errorText(err)}`)
          }
        })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, ...deps])

    useEffect(() => {
      refresh()
      const unsubscribe = subscribe(() => refresh())
      return () => {
        // Invalidiert offene Abfragen, damit nach Unmount/Re-Effect keine
        // späte Antwort mehr auf einen State schreibt.
        requestIdRef.current++
        unsubscribe()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh])

    return { data, loading, error, refresh }
  }
}
