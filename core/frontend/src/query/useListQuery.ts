import { useCallback, useEffect, useMemo, useState } from 'react'
import { matchesQuery, parseQuery, sortBySuggestion, suggestSort, type ParsedQuery, type QueryField, type SortSuggestion } from './engine'

export const QUERY_SORT_KEY = '__query'

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // nur bis zum Neuladen
  }
}

/** Zustand der Texteingabe einer Liste: Formeln zerlegen, Datensätze filtern und die Sortierung vorschlagen.
 * Sortierung: Passt eine Bedingung zu einem Zahlenfeld (z.B. «ZZ > 200»), schlägt die Liste «nach diesem Feld» vor
 * (Schlüssel `__query`) und das Sortierfeld blinkt kurz. Wer selbst eine Sortierung wählt, übersteuert den Vorschlag für diese
 * Formel; mit dem Kontrollkästchen im Sortierfeld lässt sich die Automatik abschalten (je Gerät gemerkt).
 * `storage` = Schlüsselvorsatz im localStorage, z.B. «dairy_schafe_animals». */
export function useListQuery<R, C>({
  storage,
  fields,
  ctx,
  texts,
  defaultSort,
  validSorts,
}: {
  storage: string
  fields: QueryField<R, C>[]
  ctx: C
  texts: (row: R) => (string | null | undefined)[]
  defaultSort: string
  /** Schlüssel der Sortierungen der Liste (unbekannte gespeicherte Werte fallen auf `defaultSort`) */
  validSorts: string[]
}) {
  const [text, setText] = useState('')
  const parsed: ParsedQuery<R, C> = useMemo(() => parseQuery(fields, text), [fields, text])
  const [manual, setManual] = useState(() => {
    const v = read(`${storage}_sort`, defaultSort)
    return validSorts.includes(v) ? v : defaultSort
  })
  const [autoOn, setAutoOnState] = useState(() => read(`${storage}_sort_auto`, '1') === '1')
  const suggestion = useMemo(() => suggestSort(parsed), [parsed])
  const sig = suggestion ? `${suggestion.field.key}:${suggestion.desc ? 'd' : 'a'}` : null
  const [overridden, setOverridden] = useState<string | null>(null)
  const auto: SortSuggestion<R, C> | null = autoOn && suggestion && overridden !== sig ? suggestion : null
  const sortKey = auto ? QUERY_SORT_KEY : manual

  // kurzes Aufblinken, wenn die Automatik eine neue Sortierung vorschlägt
  const [flash, setFlash] = useState(false)
  const autoSig = auto ? sig : null
  useEffect(() => {
    if (!autoSig) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 2200)
    return () => clearTimeout(t)
  }, [autoSig])

  const setSort = useCallback(
    (key: string) => {
      if (key === QUERY_SORT_KEY) {
        setOverridden(null)
        return
      }
      setManual(key)
      write(`${storage}_sort`, key)
      // eigene Wahl gilt für diese Formel; eine andere Formel schlägt wieder vor
      if (sig) setOverridden(sig)
    },
    [storage, sig],
  )
  const setAutoOn = useCallback(
    (on: boolean) => {
      setAutoOnState(on)
      write(`${storage}_sort_auto`, on ? '1' : '0')
      if (on) setOverridden(null)
    },
    [storage],
  )

  const match = useCallback((row: R) => matchesQuery(row, parsed, ctx, texts), [parsed, ctx, texts])
  const queryCompare = useMemo(() => (auto ? sortBySuggestion(auto, ctx) : null), [auto, ctx])

  return { text, setText, parsed, match, sortKey, setSort, auto, suggestion, flash, autoOn, setAutoOn, queryCompare }
}
