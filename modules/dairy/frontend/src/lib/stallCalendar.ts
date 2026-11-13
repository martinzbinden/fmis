// Stallkalender (pages/Stall.tsx): Hinweise und Tränkeplan aus Alter, Entscheiden und Belegungen.
// Alles rein (ohne Datenbank), damit es sich testen lässt; das Laden steht in lib/stallData.ts.
//
// Lämmer: Tag 10 fragen «Eimer, bei der Mutter oder später» (Entscheid je Lamm, meist für die
// Gruppe); bei der Mutter aufgezogene Lämmer werden ab ca. Tag 40 abgesetzt. Tiere, die schon
// deutlich älter sind, bevor es diese Entscheide gab, gelten als bei der Mutter aufgezogen.
// Kälber: Milchzusatz bis ca. 1 Monat, abtränken ab ca. 3,5 Monaten.
// Trockenstellen: eine Zeit vor der erwarteten Geburt (aus der Belegung).

import type { Species } from './fertility'
import { addDays, daysBetween } from './format'
import type { Lamb } from './lambs'
import type { ExpectedBirth, TodayAnimal } from './today'
import type { StallRules } from './stallRules'

export type HintKind = 'eimer' | 'absetzen' | 'milchzusatz' | 'abtraenken' | 'trockenstellen'
export type DecisionStep = 'eimer' | 'milchzusatz'
export type DecisionValue = 'eimer' | 'mutter' | 'spaeter' | 'erledigt'

export interface StallDecision {
  step: DecisionStep
  offspringId: string | null
  animalId: string | null
  decision: DecisionValue
  decidedOn: string
  until: string | null
}

/** So lange nach Tag 10 wird noch gefragt; danach gilt «bei der Mutter». */
export const EIMER_WINDOW_DAYS = 14

/** Neuester Entscheid zu diesem Jungtier und Schritt (nach Entscheiddatum, bei Gleichstand der spätere in der Liste). */
export function latestDecision(decisions: StallDecision[], step: DecisionStep, l: Pick<Lamb, 'offspringId' | 'animalId'>): StallDecision | null {
  let best: StallDecision | null = null
  for (const d of decisions) {
    if (d.step !== step) continue
    if (!((l.offspringId && d.offspringId === l.offspringId) || (l.animalId && d.animalId === l.animalId))) continue
    if (!best || d.decidedOn >= best.decidedOn) best = d
  }
  return best
}

/** Aufzucht des Lamms: Entscheid, sonst bei älteren Tieren «bei der Mutter», sonst offen. */
export function rearing(decisions: StallDecision[], l: Lamb, rules: StallRules, today: string): 'eimer' | 'mutter' | 'offen' | 'spaeter' {
  const d = latestDecision(decisions, 'eimer', l)
  if (d?.decision === 'eimer') return 'eimer'
  if (d?.decision === 'mutter') return 'mutter'
  if (d?.decision === 'spaeter' && d.until && d.until > today) return 'spaeter'
  if (l.ageDays > rules.eimerDay + EIMER_WINDOW_DAYS && d?.decision !== 'spaeter') return 'mutter'
  return 'offen'
}

export interface HintItem {
  /** Lamm/Kalb (Tränkeplan-Hinweise) oder Muttertier (Trockenstellen) */
  key: string
  lamb: Lamb | null
  animal: TodayAnimal | null
  /** an diesem Tag wird es fällig */
  due: string
  /** erwartete Geburt (Trockenstellen) */
  expected?: string
}

export interface StallHint {
  kind: HintKind
  items: HintItem[]
}

const KIND_ORDER: HintKind[] = ['eimer', 'milchzusatz', 'absetzen', 'abtraenken', 'trockenstellen']

export interface StallInput {
  lambs: Lamb[]
  decisions: StallDecision[]
  /** erwartete Geburten bis heute + Trockenstell-Vorlauf */
  expected: ExpectedBirth[]
  dryIds: Set<string>
  species: Species
  rules: StallRules
  today: string
}

export function buildStallHints(input: StallInput): StallHint[] {
  const { lambs, decisions, expected, dryIds, species, rules, today } = input
  const soon = addDays(today, rules.lookaheadDays)
  const out = new Map<HintKind, HintItem[]>()
  const add = (kind: HintKind, item: HintItem) => out.set(kind, [...(out.get(kind) ?? []), item])
  const lambItem = (l: Lamb, day: number): HintItem => ({ key: l.key, lamb: l, animal: null, due: addDays(l.birthDate, day) })

  for (const l of lambs) {
    if (!l.nursing) continue
    if (species === 'sheep') {
      const r = rearing(decisions, l, rules, today)
      const fromWindow = addDays(l.birthDate, rules.eimerDay)
      const toWindow = addDays(l.birthDate, rules.eimerDay + EIMER_WINDOW_DAYS)
      // fragen: von Tag 10 (mit Vorlauf) bis Ende des Fensters; «später» kommt nach seinem Datum wieder
      const d = latestDecision(decisions, 'eimer', l)
      const askAgain = d?.decision === 'spaeter' && d.until != null && d.until <= today
      if (rules.eimerDay > 0 && r === 'offen' && (askAgain || (addDays(fromWindow, -rules.lookaheadDays) <= today && today <= toWindow))) add('eimer', lambItem(l, rules.eimerDay))
      if (rules.absetzenDay > 0 && r === 'mutter' && addDays(l.birthDate, rules.absetzenDay) <= soon) add('absetzen', lambItem(l, rules.absetzenDay))
    } else {
      const done = latestDecision(decisions, 'milchzusatz', l)?.decision === 'erledigt'
      if (rules.milchzusatzDays > 0 && !done && addDays(l.birthDate, rules.milchzusatzDays) <= soon) add('milchzusatz', lambItem(l, rules.milchzusatzDays))
      if (rules.abtraenkenDays > 0 && addDays(l.birthDate, rules.abtraenkenDays) <= soon) add('abtraenken', lambItem(l, rules.abtraenkenDays))
    }
  }

  if (rules.trockenDays > 0) {
    for (const e of expected) {
      if (dryIds.has(e.animal.id)) continue
      const due = addDays(e.from, -rules.trockenDays)
      if (due <= soon) add('trockenstellen', { key: e.animal.id, lamb: null, animal: e.animal, due, expected: e.from })
    }
  }

  return KIND_ORDER.filter((k) => out.has(k)).map((kind) => ({ kind, items: out.get(kind)!.sort((a, b) => a.due.localeCompare(b.due)) }))
}

export type DueState = 'ueberfaellig' | 'heute' | 'bald'
export const dueState = (due: string, today: string): DueState => (due < today ? 'ueberfaellig' : due === today ? 'heute' : 'bald')

// ---- Tränkeplan ----

export type PhaseKey = 'neu' | 'mutter' | 'eimer' | 'spaeter' | 'zusatz' | 'milch'

export interface Phase {
  key: PhaseKey
  lambs: { lamb: Lamb; /** nächster Schritt: Text und Tag */ next: { text: string; due: string } | null }[]
}

const PHASE_ORDER: PhaseKey[] = ['neu', 'spaeter', 'eimer', 'mutter', 'zusatz', 'milch']

/** Wo steht jedes saugende Jungtier in der Aufzucht, und was kommt als Nächstes? */
export function buildFeedingPlan(lambs: Lamb[], decisions: StallDecision[], species: Species, rules: StallRules, today: string): Phase[] {
  const phases = new Map<PhaseKey, Phase['lambs']>()
  const put = (key: PhaseKey, lamb: Lamb, next: { text: string; due: string } | null) => phases.set(key, [...(phases.get(key) ?? []), { lamb, next }])
  const at = (l: Lamb, day: number) => addDays(l.birthDate, day)
  for (const l of lambs) {
    if (!l.nursing) continue
    if (species === 'sheep') {
      const r = rearing(decisions, l, rules, today)
      if (r === 'eimer') put('eimer', l, null)
      else if (r === 'mutter') put('mutter', l, { text: 'Absetzen', due: at(l, rules.absetzenDay) })
      else if (r === 'spaeter') put('spaeter', l, { text: 'Eimer-Entscheid', due: latestDecision(decisions, 'eimer', l)!.until! })
      else put('neu', l, { text: 'Eimer oder Mutter?', due: at(l, rules.eimerDay) })
    } else {
      const done = latestDecision(decisions, 'milchzusatz', l)?.decision === 'erledigt'
      if (!done && l.ageDays < rules.milchzusatzDays) put('zusatz', l, { text: 'Milchzusatz beenden', due: at(l, rules.milchzusatzDays) })
      else put('milch', l, { text: 'Abtränken', due: at(l, rules.abtraenkenDays) })
    }
  }
  return PHASE_ORDER.filter((k) => phases.has(k)).map((key) => ({ key, lambs: phases.get(key)!.sort((a, b) => (a.next?.due ?? '9').localeCompare(b.next?.due ?? '9') || a.lamb.birthDate.localeCompare(b.lamb.birthDate)) }))
}

export const daysUntil = (due: string, today: string) => daysBetween(today, due)
