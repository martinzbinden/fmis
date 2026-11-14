// Ausmerzliste, Vorschlag für die nächste Schlachtung (pages/Culling.tsx): aus den Gründen der Liste,
// dem aktuellen Trächtigkeitsergebnis und dem Wert eines Tiers eine Reihenfolge bilden, und daraus die
// ersten N Tiere vorschlagen. Entscheide per Daumen: leben (bleibt, ausgegraut) oder schlachten (fest).
// Tiere, die wegfallen, werden durch die nächsten der Reihenfolge ersetzt. Rein, damit sich alles testen lässt.

import { indexScale, totalIndex } from './herdPerformance'
import type { PregnancyStatus } from './pregnancy'
import { daysBetween } from './format'

export type Mark = 'leben' | 'schlachten'

/** Wie das Tier im Vorschlag steht. */
export type PlanState =
  /** vorgeschlagen zum Schlachten */
  | 'vorschlag'
  /** Daumen runter: fest auf der Liste */
  | 'fix'
  /** Daumen hoch: bleibt (ausgegraut) */
  | 'leben'
  /** wertvoll, bekommt noch eine Chance (ausgegraut; Daumen runter holt es auf die Liste) */
  | 'chance'

export interface PlanBase {
  id: string
  label: string
  /** Summe der Gewichte der Gründe (lib/culling.ts reasonScore) */
  score: number
  pregnancy: PregnancyStatus | null
  /** Wert des Tiers (Mittel 100), null = unbekannt */
  value: number | null
}

/** Zusatz zur Punktzahl aus dem aktuellen Trächtigkeitsergebnis: ein frisches «leer» zieht das Tier nach oben,
 * «trächtig» weit nach unten (ein trächtiges Tier schlachtet man nur bei schweren Gründen). */
export function pregnancyAdjustment(p: PregnancyStatus | null, today: string): number {
  if (!p) return 0
  const age = daysBetween(p.date, today)
  if (p.result === 'nein') return age <= 60 ? 3 : age <= 120 ? 2 : 1
  if (p.result === 'unsicher') return age <= 60 ? 1 : 0
  return -4
}

export const priority = (r: Pick<PlanBase, 'score' | 'pregnancy'>, today: string): number => r.score + pregnancyAdjustment(r.pregnancy, today)

/** Wertvoll = Wert ab der Grenze (0 = Schutz aus). */
export const isValuable = (value: number | null, threshold: number): boolean => threshold > 0 && value != null && value >= threshold

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null)

/** Wert je Tier: Mittel aus den vorhandenen Teilen, alle auf Mittel 100 / Streuung 10 in der Herde:
 * Leistungs-/Zellzahlindex, Gesamtzuchtwert und (Schafe) mittlere Wurfgrösse. Ohne jeden Teil null. */
export function valueScores(
  animals: { id: string; idxPerformance: number | null; idxScc: number | null; totalBv: number | null; litterMean: number | null }[],
): Map<string, number | null> {
  const bv = indexScale(new Map(animals.map((a) => [a.id, a.totalBv])))
  const litter = indexScale(new Map(animals.map((a) => [a.id, a.litterMean])))
  return new Map(
    animals.map((a) => {
      const parts = [totalIndex(a.idxPerformance, a.idxScc), bv.get(a.id) ?? null, litter.get(a.id) ?? null].filter((x): x is number => x != null)
      return [a.id, mean(parts)]
    }),
  )
}

export interface PlanEntry<T extends PlanBase> {
  row: T
  state: PlanState
  priority: number
}

export interface Plan<T extends PlanBase> {
  /** in der Reihenfolge der Dringlichkeit; ausgegraute Tiere stehen an ihrem Platz */
  shown: PlanEntry<T>[]
  /** Tiere, die jetzt zum Schlachten stehen (vorgeschlagen + fest) */
  active: number
  /** weitere Kandidaten, die nachrücken würden */
  waiting: number
}

/** Der Vorschlag: `n` Tiere zum Schlachten. Feste (Daumen runter) zählen immer mit; Daumen hoch und
 * wertvolle Tiere stehen ausgegraut an ihrem Platz und zählen nicht; für sie rückt das nächste nach.
 * Kandidat ist, wer mindestens einen Punkt hat. */
export function buildPlan<T extends PlanBase>(rows: T[], marks: Map<string, Mark>, opts: { n: number; today: string; valueThreshold: number }): Plan<T> {
  const entries = rows
    .map((row) => ({ row, priority: priority(row, opts.today), mark: marks.get(row.id) ?? null }))
    .filter((e) => e.mark === 'schlachten' || e.priority >= 1)
    // dringlichste zuerst; bei gleicher Dringlichkeit das weniger wertvolle Tier zuerst
    .sort((a, b) => b.priority - a.priority || (a.row.value ?? 100) - (b.row.value ?? 100) || a.row.label.localeCompare(b.row.label, 'de', { numeric: true }))

  const fixed = entries.filter((e) => e.mark === 'schlachten')
  const open = Math.max(0, opts.n - fixed.length)
  const picked = new Set(fixed.map((e) => e.row.id))
  const stateOf = new Map<string, PlanState>(fixed.map((e) => [e.row.id, 'fix']))
  let taken = 0
  let lastTaken = -1
  const rest = entries.filter((e) => e.mark !== 'schlachten')
  rest.forEach((e, i) => {
    if (taken >= open) return
    if (e.mark === 'leben') stateOf.set(e.row.id, 'leben')
    else if (isValuable(e.row.value, opts.valueThreshold)) stateOf.set(e.row.id, 'chance')
    else {
      stateOf.set(e.row.id, 'vorschlag')
      taken++
      lastTaken = i
    }
    picked.add(e.row.id)
  })
  // Ausgegraute Tiere hinter dem letzten vorgeschlagenen sind überflüssig
  const lastIdx = lastTaken
  const shown: PlanEntry<T>[] = entries
    .filter((e) => {
      const st = stateOf.get(e.row.id)
      if (!st) return false
      if (st === 'fix' || st === 'vorschlag') return true
      return rest.indexOf(e) < lastIdx
    })
    .map((e) => ({ row: e.row, state: stateOf.get(e.row.id)!, priority: e.priority }))
  const active = shown.filter((s) => s.state === 'fix' || s.state === 'vorschlag').length
  const shownIds = new Set(shown.map((s) => s.row.id))
  const waiting = rest.filter((e) => !shownIds.has(e.row.id) && e.mark !== 'leben' && !isValuable(e.row.value, opts.valueThreshold)).length
  return { shown, active, waiting }
}
