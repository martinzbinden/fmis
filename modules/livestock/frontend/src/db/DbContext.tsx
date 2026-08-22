import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { getDb } from './pglite'

const DbContext = createContext<PGlite | null>(null)

export function DbProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<PGlite | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getDb()
      .then((pg) => {
        if (!cancelled) setDb(pg)
      })
      .catch((err) => {
        console.error('pglite Initialisierung fehlgeschlagen', err)
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold text-red-700">Datenbank-Fehler</p>
          <p className="mt-2 text-sm text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  if (!db) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
          <p className="text-sm text-gray-500">Datenbank wird initialisiert…</p>
        </div>
      </div>
    )
  }

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

export function useDb(): PGlite {
  const db = useContext(DbContext)
  if (!db) throw new Error('useDb() ausserhalb von <DbProvider> verwendet')
  return db
}
