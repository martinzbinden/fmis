// Regeln des Stallkalenders (lib/stallCalendar.ts): ab welchem Alter oder Zeitpunkt welcher Hinweis
// kommt. Vorgaben je Tierart, je Gerät änderbar (localStorage, gleiches Muster wie cullingSettings.ts).

import { useCallback, useState } from 'react'
import type { Species } from './fertility'

export interface StallRules {
  /** Lämmer: ab diesem Alter fragen, ob auf Eimer umgestellt wird (Tage) */
  eimerDay: number
  /** Lämmer bei der Mutter: absetzen ab diesem Alter (Tage) */
  absetzenDay: number
  /** Kälber: Milchzusatz bis zu diesem Alter, dann absetzen (Tage) */
  milchzusatzDays: number
  /** Kälber: abtränken ab diesem Alter (Tage), ca. 3,5 Monate */
  abtraenkenDays: number
  /** Tierarzt: Trächtigkeit untersuchen ab so vielen Tagen nach der Belegung */
  kontrolleFromDays: number
  /** Trockenstellen so viele Tage vor der erwarteten Geburt */
  trockenDays: number
  /** Hinweis so viele Tage vor dem Termin schon zeigen */
  lookaheadDays: number
}

export const DEFAULT_STALL_RULES: Record<Species, StallRules> = {
  sheep: { eimerDay: 10, absetzenDay: 40, milchzusatzDays: 0, abtraenkenDays: 0, kontrolleFromDays: 35, trockenDays: 56, lookaheadDays: 3 },
  cattle: { eimerDay: 0, absetzenDay: 0, milchzusatzDays: 30, abtraenkenDays: 106, kontrolleFromDays: 40, trockenDays: 60, lookaheadDays: 3 },
}

/** Beschriftung und Einheit der Regeln je Tierart (nur die, die für die Tierart gelten). */
export const RULE_FIELDS: Record<Species, { key: keyof StallRules; label: string }[]> = {
  sheep: [
    { key: 'eimerDay', label: 'Auf Eimer umstellen fragen ab Tag' },
    { key: 'absetzenDay', label: 'Absetzen bei der Mutter ab Tag' },
    { key: 'kontrolleFromDays', label: 'Trächtigkeit untersuchen ab Tag nach Belegung' },
    { key: 'trockenDays', label: 'Trockenstellen Tage vor der Ablammung' },
    { key: 'lookaheadDays', label: 'Hinweis Tage vorher zeigen' },
  ],
  cattle: [
    { key: 'milchzusatzDays', label: 'Milchzusatz bis Tag' },
    { key: 'abtraenkenDays', label: 'Abtränken ab Tag (3,5 Monate ≈ 106)' },
    { key: 'kontrolleFromDays', label: 'Trächtigkeit untersuchen ab Tag nach Besamung' },
    { key: 'trockenDays', label: 'Trockenstellen Tage vor der Abkalbung' },
    { key: 'lookaheadDays', label: 'Hinweis Tage vorher zeigen' },
  ],
}

const storageKey = (moduleKey: string) => `${moduleKey}_stall_rules`

export function loadRules(moduleKey: string, species: Species): StallRules {
  const defaults = DEFAULT_STALL_RULES[species]
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(moduleKey)) ?? 'null') as Partial<Record<keyof StallRules, unknown>> | null
    if (!parsed) return defaults
    const merged = { ...defaults }
    for (const k of Object.keys(defaults) as (keyof StallRules)[]) {
      const v = Number(parsed[k])
      if (parsed[k] != null && Number.isFinite(v) && v >= 0) merged[k] = Math.round(v)
    }
    return merged
  } catch {
    return defaults
  }
}

export function useStallRules(moduleKey: string, species: Species) {
  const [rules, setRules] = useState(() => loadRules(moduleKey, species))
  const update = useCallback(
    (next: StallRules) => {
      setRules(next)
      try {
        localStorage.setItem(storageKey(moduleKey), JSON.stringify(next))
      } catch {
        // nur bis zum Neuladen
      }
    },
    [moduleKey],
  )
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(storageKey(moduleKey))
    } catch {
      // egal
    }
    setRules(DEFAULT_STALL_RULES[species])
  }, [moduleKey, species])
  return { rules, update, reset }
}
