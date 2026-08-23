import { useMemo, useState } from 'react'

/**
 * Schnelles Eingrenzen von Tiertabellen nach (Teil-)Ziffern der Ohrmarke,
 * z.B. findet "456" auch "CH123456789" — reiner Substring-Match, damit man
 * nicht das volle Format inkl. Länder-Präfix tippen muss.
 */
export function useEarTagFilter<T>(
  items: T[] | undefined,
  getEarTag: (item: T) => string,
): { filter: string; setFilter: (v: string) => void; filtered: T[] | undefined } {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    if (!items) return items
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => getEarTag(item).toLowerCase().includes(q))
  }, [items, filter, getEarTag])

  return { filter, setFilter, filtered }
}
