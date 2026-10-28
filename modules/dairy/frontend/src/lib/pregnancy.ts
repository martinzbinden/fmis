// Trächtigkeit erfassen (pages/PregnancyEntry.tsx): Tier über die letzten Ziffern der Ohrmarke finden.

import { shortEarTag } from '@fmis/core/earTag'
import type { Animal, PregnancyCheck, PregnancyMethod, PregnancyResult } from '../types'

export const RESULT_LABEL: Record<PregnancyResult, string> = { ja: 'trächtig', nein: 'leer', unsicher: 'unsicher' }
export const METHOD_LABEL: Record<PregnancyMethod, string> = { auge: 'Auge', farbtupfer: 'Farbtupfer', ultraschall: 'Ultraschall' }

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

/** Durchgang: Untersuchung einer Person mit einer Methode (schema/0016). */
export interface PregnancyRound {
  id: string
  date: string
  examiner: string | null
  method: PregnancyMethod | null
}
export interface RoundSummary extends PregnancyRound {
  count: number
  results: Record<PregnancyResult, number>
  /** letzter Eintrag (ISO) */
  last: string
}

/** Durchgänge aus den Einträgen, neuester zuerst. Einträge ohne round_id (ältere App) je Tag. */
export function groupRounds(checks: Pick<PregnancyCheck, 'animal_id' | 'check_date' | 'result' | 'recorded_at' | 'round_id' | 'examiner' | 'method'>[]): RoundSummary[] {
  const groups = new Map<string, typeof checks>()
  for (const c of checks) {
    const id = c.round_id ?? `tag:${c.check_date}`
    const g = groups.get(id)
    if (g) g.push(c)
    else groups.set(id, [c])
  }
  return [...groups.entries()]
    .map(([id, g]) => {
      const newest = g.reduce((a, b) => (a.recorded_at > b.recorded_at ? a : b))
      return {
        id,
        date: newest.check_date,
        examiner: newest.examiner,
        method: newest.method,
        count: new Set(g.map((c) => c.animal_id)).size,
        results: summarize(g),
        last: newest.recorded_at,
      }
    })
    .sort((a, b) => (a.last < b.last ? 1 : -1))
}

/** Bisherige Untersucher, zuletzt verwendete zuerst. */
export function examiners(checks: Pick<PregnancyCheck, 'examiner' | 'recorded_at'>[]): string[] {
  const out: string[] = []
  for (const c of [...checks].sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1))) {
    const e = c.examiner?.trim()
    if (e && !out.includes(e)) out.push(e)
  }
  return out
}
