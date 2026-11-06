// Empfehlung Zucht oder Mast gleich nach der Geburt. Sie vergleicht zwei Grössen auf derselben Skala
// (Mittel 100): den Index der Mutter aus Leistung, Zellzahl und Tendenz (lib/lambSelection.ts) und den
// erwarteten Zuchtwert des Jungtiers, das Mittel der Gesamtzuchtwerte beider Eltern. Ein unbekannter
// Elternteil zählt als 100. Die Schwellen sind Annahmen und lassen sich hier anpassen; entscheiden
// tut der Mensch, gespeichert wird nur seine Wahl.

export type Preselection = 'zucht' | 'eher_ja' | 'spaeter' | 'eher_nein' | 'mast'

export const PRESELECTIONS: { key: Preselection; label: string }[] = [
  { key: 'zucht', label: 'Zucht' },
  { key: 'eher_ja', label: 'eher ja' },
  { key: 'spaeter', label: 'später' },
  { key: 'eher_nein', label: 'eher nein' },
  { key: 'mast', label: 'Mast' },
]

export const preselectionLabel = (p: Preselection | null | undefined): string | null => PRESELECTIONS.find((x) => x.key === p)?.label ?? null

export const SCORE_ZUCHT = 105
export const SCORE_EHER_JA = 100
export const SCORE_EHER_NEIN = 95
export const SCORE_MALE_EHER_JA = 110
export const INBREEDING_LIMIT = 0.0625

export interface RecommendationInput {
  sex: 'w' | 'm' | null
  /** Index der Mutter aus eigener Leistung; null = nicht bewertet */
  damIndex: number | null
  /** Datenbasis der Mutter, «duenn» = wenige Proben */
  damBasis?: string | null
  damValue: number | null
  sireValue: number | null
  inbreeding: number
}

export interface Recommendation {
  choice: Preselection
  score: number | null
  reasons: string[]
}

const fmt = (v: number) => v.toLocaleString('de-CH', { maximumFractionDigits: 1 })
const round1 = (v: number) => Math.round(v * 10) / 10
const ORDER: Preselection[] = ['mast', 'eher_nein', 'eher_ja', 'zucht']
const atMost = (c: Preselection, limit: Preselection) => (ORDER.indexOf(c) > ORDER.indexOf(limit) ? limit : c)
const atLeast = (c: Preselection, limit: Preselection) => (ORDER.indexOf(c) < ORDER.indexOf(limit) ? limit : c)

export function recommendLamb(i: RecommendationInput): Recommendation {
  const reasons: string[] = []
  const expected = i.damValue != null || i.sireValue != null ? round1(((i.damValue ?? 100) + (i.sireValue ?? 100)) / 2) : null
  if (i.damIndex != null) reasons.push(`Mutter Index ${fmt(i.damIndex)}`)
  if (expected != null) reasons.push(`erwarteter Zuchtwert ${fmt(expected)}`)
  const parts = [i.damIndex, expected].filter((v): v is number => v != null)
  if (parts.length === 0) return { choice: 'spaeter', score: null, reasons: ['Zu wenig Daten zu den Eltern.'] }
  const score = round1(parts.reduce((a, b) => a + b, 0) / parts.length)

  let choice: Preselection
  if (i.sex === 'm') {
    // Widder oder Stier zieht man selten selbst nach: nur bei klar überdurchschnittlichen Eltern
    choice = score >= SCORE_MALE_EHER_JA ? 'eher_ja' : score >= SCORE_EHER_JA ? 'eher_nein' : 'mast'
    reasons.push('männlich: nur bei sehr guten Eltern zur Zucht')
  } else {
    choice = score >= SCORE_ZUCHT ? 'zucht' : score >= SCORE_EHER_JA ? 'eher_ja' : score >= SCORE_EHER_NEIN ? 'eher_nein' : 'mast'
  }
  // Nur eine Grösse oder dünne Daten: nicht zu sicher sein
  if (parts.length === 1 || i.damBasis === 'duenn') {
    if (choice === 'zucht' || choice === 'mast') reasons.push(parts.length === 1 ? 'nur eine Datenquelle' : 'wenige Daten zur Mutter')
    choice = atLeast(atMost(choice, 'eher_ja'), 'eher_nein')
  }
  if (i.inbreeding >= INBREEDING_LIMIT) {
    if (ORDER.indexOf(choice) > ORDER.indexOf('eher_nein')) reasons.push(`Inzucht ${fmt(i.inbreeding * 100)} %: höchstens «eher nein»`)
    else reasons.push(`Inzucht ${fmt(i.inbreeding * 100)} %`)
    choice = atMost(choice, 'eher_nein')
  }
  return { choice, score, reasons }
}
