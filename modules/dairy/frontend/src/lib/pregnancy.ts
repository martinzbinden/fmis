// Trächtigkeit erfassen (pages/PregnancyEntry.tsx): Tier über die letzten Ziffern der Ohrmarke finden.

import { shortEarTag } from '@fmis/core/earTag'
import type { Animal, PregnancyCheck, PregnancyResult } from '../types'

export const RESULT_LABEL: Record<PregnancyResult, string> = { ja: 'trächtig', nein: 'leer', unsicher: 'unsicher' }

/** Ziffern der Ohrmarke in Kurzform (CH 2172 8023 → 21728023). */
export const tagDigits = (a: Pick<Animal, 'ear_tag'>) => shortEarTag(a.ear_tag).replace(/\D/g, '')

/** Tiere, deren Ohrmarke auf die eingegebenen Ziffern endet (bei 1–2 Ziffern auch die Laufnummer). */
export function matchAnimals(animals: Animal[], input: string): Animal[] {
  const q = input.replace(/\D/g, '')
  if (!q) return []
  const byTag = animals.filter((a) => tagDigits(a).endsWith(q))
  const byNr = q.length <= 3 ? animals.filter((a) => a.lauf_nr === q && !byTag.includes(a)) : []
  return [...byTag, ...byNr]
}

/** Eindeutig erst ab 3 Ziffern (bei weniger stimmen zufällig zu viele Ohrmarken überein). */
export function uniqueMatch(animals: Animal[], input: string): Animal | null {
  const q = input.replace(/\D/g, '')
  if (q.length < 3) return null
  const m = animals.filter((a) => tagDigits(a).endsWith(q))
  return m.length === 1 ? m[0] : null
}

/** Ergebnisse je Ergebnisart für einen Tag (jedes Tier zählt mit seinem letzten Eintrag). */
export function summarize(checks: Pick<PregnancyCheck, 'animal_id' | 'result' | 'recorded_at'>[]): Record<PregnancyResult, number> {
  const last = new Map<string, Pick<PregnancyCheck, 'result' | 'recorded_at'>>()
  for (const c of checks) {
    const prev = last.get(c.animal_id)
    if (!prev || prev.recorded_at < c.recorded_at) last.set(c.animal_id, c)
  }
  const out: Record<PregnancyResult, number> = { ja: 0, nein: 0, unsicher: 0 }
  for (const c of last.values()) out[c.result]++
  return out
}
