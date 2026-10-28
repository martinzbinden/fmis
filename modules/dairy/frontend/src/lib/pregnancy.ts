// Trächtigkeit erfassen (pages/PregnancyEntry.tsx): Tier über die letzten Ziffern der Ohrmarke finden.

import { shortEarTag } from '@fmis/core/earTag'
import { isoDate } from './format'
import type { Animal, DurationUnit, PregnancyCheck, PregnancyMethod, PregnancyResult } from '../types'

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

/** Uhrzeit von–bis eines Durchgangs, z.B. "16:15–16:47" (Ortszeit). */
export function fmtTimeRange(first: string, last: string): string {
  const t = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
  const [a, b] = [t(first), t(last)]
  return a === b ? a : `${a}–${b}`
}

/** Lämmer jünger als `months` Monate am Stichtag (ohne Geburtsdatum: kein Lamm). */
export function isYoung(a: Pick<Animal, 'birth_date'>, refIso: string, months = 7): boolean {
  const b = isoDate(a.birth_date)
  if (!b) return false
  const [y, m, d] = refIso.split('-').map(Number)
  const limit = new Date(Date.UTC(y, m - 1 - months, d)).toISOString().slice(0, 10)
  return b > limit
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
  /** Dauer in Wochen oder Tagen erfassen */
  unit: DurationUnit
}
export interface RoundSummary extends PregnancyRound {
  count: number
  results: Record<PregnancyResult, number>
  /** erster und letzter Eintrag (ISO) */
  first: string
  last: string
}

/** Durchgänge aus den Einträgen, neuester zuerst. Einträge ohne round_id (ältere App) je Tag. */
export function groupRounds(checks: Pick<PregnancyCheck, 'animal_id' | 'check_date' | 'result' | 'recorded_at' | 'round_id' | 'examiner' | 'method' | 'duration_unit'>[]): RoundSummary[] {
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
      const oldest = g.reduce((a, b) => (a.recorded_at < b.recorded_at ? a : b))
      return {
        id,
        date: newest.check_date,
        examiner: newest.examiner,
        method: newest.method,
        unit: newest.duration_unit ?? 'wochen',
        count: new Set(g.map((c) => c.animal_id)).size,
        results: summarize(g),
        first: oldest.recorded_at,
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

/** Eingabe in Wochen bzw. Tagen → gespeicherte Wochen (null bei leer/ungültig). */
export function toWeeks(input: string, unit: DurationUnit): number | null {
  const v = Number(input.trim().replace(',', '.'))
  if (!input.trim() || !Number.isFinite(v) || v <= 0) return null
  return unit === 'tage' ? v / 7 : v
}

/** Gespeicherte Wochen → Wert fürs Eingabefeld in der gewählten Einheit. */
export function fromWeeks(weeks: number | null, unit: DurationUnit): string {
  if (weeks == null) return ''
  return unit === 'tage' ? String(Math.round(weeks * 7)) : String(Math.round(weeks * 10) / 10)
}

/** Kurzanzeige der Dauer, z.B. «8 Wo.» oder «45 T.». */
export function fmtDuration(weeks: number | null, unit: DurationUnit | null): string | null {
  if (weeks == null) return null
  return unit === 'tage' ? `${Math.round(weeks * 7)} T.` : `${fromWeeks(weeks, 'wochen')} Wo.`
}

export type CompareCheck = Pick<PregnancyCheck, 'animal_id' | 'check_date' | 'result' | 'weeks' | 'recorded_at' | 'round_id' | 'duration_unit'>
export interface CompareRow<C extends CompareCheck = CompareCheck> {
  animal_id: string
  /** je Durchgang (in der Reihenfolge von roundIds) der letzte Eintrag oder undefined */
  cells: (C | undefined)[]
  /** Ergebnisse der Durchgänge, in denen das Tier untersucht wurde, stimmen nicht überein */
  differs: boolean
}

/** Tiere × Durchgänge zum Abgleich (z.B. eigene Einschätzung gegen Ultraschall des Tierarztes). */
export function compareRounds<C extends CompareCheck>(checks: C[], roundIds: string[]): CompareRow<C>[] {
  const roundOf = (c: CompareCheck) => c.round_id ?? `tag:${c.check_date}`
  const byAnimal = new Map<string, (C | undefined)[]>()
  for (const c of checks) {
    const i = roundIds.indexOf(roundOf(c))
    if (i < 0) continue
    const cells = byAnimal.get(c.animal_id) ?? roundIds.map(() => undefined)
    const prev = cells[i]
    if (!prev || prev.recorded_at < c.recorded_at) cells[i] = c
    byAnimal.set(c.animal_id, cells)
  }
  return [...byAnimal.entries()].map(([animal_id, cells]) => {
    const results = new Set(cells.filter((c): c is C => !!c).map((c) => c.result))
    return { animal_id, cells, differs: results.size > 1 }
  })
}
