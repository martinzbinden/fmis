// Empfehlung auf der Karte im Dashboard (Ampel-Kante): dieselben Punkte wie der Vorschlag «Schlachten»
// (lib/cullingPlan.ts priority): Ausmerzgründe + Trächtigkeit + Milch gegen Futter bis zur Geburt.
// Dazu die Geldbilanz zum Aufklappen: Schlachtwert jetzt gegen Milch minus Futter bis zur nächsten Geburt.

import { reasonScore, type CullingReason } from './culling'
import { priority } from './cullingPlan'
import { milkFeedPoints } from './milkFeed'
import type { PregnancyStatus } from './pregnancy'

export type Verdict = 'ausmerzen' | 'beobachten' | 'behalten' | 'jung'

export const VERDICT_LABEL: Record<Verdict, string> = {
  ausmerzen: 'Ausmerzen prüfen',
  beobachten: 'Beobachten',
  behalten: 'Behalten',
  jung: 'Jungtier',
}

/** Ab diesen Punkten: rot bzw. gelb (Punkte wie in der Liste «Schlachten») */
export const VERDICT_RED = 5
export const VERDICT_AMBER = 2

export interface VerdictInput {
  reasons: CullingReason[]
  pregnancy: PregnancyStatus | null
  /** Milchgeld − Futter bis zur nächsten Geburt (null = unbekannt) */
  balance: number | null
  frPerPoint: number
  /** Alter in Monaten; Tiere ohne Geburt und unter 12 Monaten sind Jungtiere */
  ageMonths: number | null
  parity: number | null
  today: string
}

export interface VerdictResult {
  verdict: Verdict
  points: number
  /** Teile der Punkte, für den Tooltip */
  parts: { label: string; points: number }[]
}

export function cardVerdict(i: VerdictInput): VerdictResult {
  const score = reasonScore(i.reasons)
  const mf = milkFeedPoints(i.balance, i.frPerPoint)
  const points = priority({ score, pregnancy: i.pregnancy, milkFeedPoints: mf }, i.today)
  const pregnancyPoints = points - score - mf
  const parts = [
    { label: 'Ausmerzgründe', points: score },
    { label: 'Trächtigkeit', points: pregnancyPoints },
    { label: 'Milch gegen Futter', points: mf },
  ].filter((p) => p.points !== 0)
  const young = !i.parity && i.ageMonths != null && i.ageMonths < 12
  if (young && score === 0) return { verdict: 'jung', points, parts }
  return { verdict: points >= VERDICT_RED ? 'ausmerzen' : points >= VERDICT_AMBER ? 'beobachten' : 'behalten', points, parts }
}

/** Geldbilanz: was bringt schlachten jetzt gegen behalten bis zur Geburt? (null, wenn eine Seite fehlt) */
export function moneyBalance(meatNet: number | null, keepBalance: number | null): { slaughter: number; keep: number; diff: number } | null {
  if (meatNet == null || keepBalance == null) return null
  return { slaughter: meatNet, keep: keepBalance, diff: meatNet - keepBalance }
}
