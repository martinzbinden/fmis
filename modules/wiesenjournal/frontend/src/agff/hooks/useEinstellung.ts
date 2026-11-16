// Einstellung lesen und schreiben, die sich auch von aussen ändern kann (Cloud-Abgleich, anderer Tab). Das Feld zeigt
// dann den neuen Wert, ausser der Entwurf im Feld meint schon dasselbe (z.B. «1,» beim Tippen von «1,5»).
import { useEffect, useState } from 'react'
import { getSetting, setSetting } from '../db/write'
import { useQuery } from './useQuery'

const gleich = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Gespeicherter Wert (immer aktuell) und Setzer. */
export function useEinstellung<T>(key: string, vorgabe: T): [T, (v: T) => void] {
  const { data } = useQuery((s) => JSON.stringify(getSetting<T>(key, vorgabe, s)), [key])
  return [JSON.parse(data) as T, (v: T) => setSetting(key, v)]
}

/**
 * Entwurf für ein Textfeld zu einem gespeicherten Wert: folgt dem Wert, wenn er sich ändert und der Entwurf etwas anderes
 * meint; ungültige Zwischenstände beim Tippen bleiben stehen.
 */
export function useEntwurf<T>(wert: T, text: (v: T) => string, lesen: (t: string) => T | null): [string, (t: string) => void] {
  const [entwurf, setEntwurf] = useState(() => text(wert))
  const schluessel = JSON.stringify(wert)
  useEffect(() => {
    setEntwurf((e) => (gleich(lesen(e), wert) ? e : text(wert)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel])
  return [entwurf, setEntwurf]
}
