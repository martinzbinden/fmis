import { useMemo, useSyncExternalStore } from 'react'
import { db } from '../db/db'
import type { Store } from '../db/store'

/** Liest synchron aus dem Store und rechnet neu, sobald sich Daten ändern. Kein Laden, kein Flackern. */
export function useQuery<T>(load: (s: Store) => T, deps: unknown[]): { data: T; loading: false; error: null } {
  const s = db()
  const version = useSyncExternalStore(
    (l) => s.subscribe(l),
    () => s.version,
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => load(s), [version, ...deps])
  return { data, loading: false, error: null }
}
