// Milch, die Lämmer bei der Mutter getrunken haben — geschätzt aus ihrem Zuwachs: Gewicht bei der Geburt oder beim
// Ohrmarkensetzen, Gewicht beim Absetzen oder Wegnehmen (schema/0027, 0033). Zuwachs × Milchfaktor = Milch (Faustregel
// 4–6 kg Milch je kg Zuwachs, Vorgabe 5). Es zählt nur die Zeit, in der das Lamm hauptsächlich von Milch lebt:
// bis zum Alter `maxDays` (Beifutter verfälscht danach), bis zum Absetzen und bis zur Umstellung auf Eimer.
// Das ist eine Näherung (Grössenordnung), keine Messung.

import type { PGlite } from '@electric-sql/pglite'
import { addDays, daysBetween, isoDate } from './format'
import { loadLambs, type Lamb } from './lambs'

export interface LambMilkSettings {
  /** kg Milch je kg Zuwachs */
  factor: number
  /** nur bis zu diesem Alter (Tage) rechnen */
  maxDays: number
  /** mindestens so viele Tage zwischen erster und letzter Wägung */
  minDays: number
  /** ohne Wägung der Lämmer: Milch, die 1 / 2 / 3 und mehr saugende Lämmer zusammen je Tag trinken (kg) */
  perDay1: number
  perDay2: number
  perDay3: number
}

// Vorgaben ohne Wägung: Tageszunahme etwa 300 g (Einling), 250 g (Zwilling), 200 g (Drilling) je Lamm, mal 5 kg Milch
// je kg Zuwachs → zusammen rund 1.5 / 2.5 / 3 kg Milch je Tag.
export const DEFAULT_LAMB_MILK: LambMilkSettings = { factor: 5, maxDays: 35, minDays: 7, perDay1: 1.5, perDay2: 2.5, perDay3: 3 }

export interface LambMilkEstimate {
  /** Beginn und Ende des gerechneten Zeitraums */
  from: string
  to: string
  days: number
  gainKg: number
  gainPerDay: number
  milkKg: number
  milkPerDay: number
}

type Point = { date: string; kg: number }

function weightAt(points: Point[], date: string): number {
  const after = points.findIndex((p) => p.date >= date)
  if (after <= 0) return points[Math.max(0, after)].kg
  const a = points[after - 1]
  const b = points[after]
  if (b.date === date) return b.kg
  return a.kg + ((b.kg - a.kg) * daysBetween(a.date, date)) / daysBetween(a.date, b.date)
}

export function lambMilk(
  l: Pick<Lamb, 'birthDate' | 'birthWeight' | 'weights' | 'weanDate'>,
  s: LambMilkSettings,
  /** Datum, ab dem das Lamm auf Eimer lief (null = nie) */
  bucketFrom: string | null = null,
): LambMilkEstimate | null {
  const raw: Point[] = [...(l.birthWeight != null ? [{ date: l.birthDate, kg: l.birthWeight }] : []), ...l.weights.map((w) => ({ date: w.date, kg: w.kg }))]
  const byDate = new Map(raw.map((p) => [p.date, p]))
  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (points.length < 2) return null
  const from = points[0].date
  const to = [points[points.length - 1].date, l.weanDate, addDays(l.birthDate, s.maxDays), bucketFrom].filter((d): d is string => !!d).sort()[0]
  const days = daysBetween(from, to)
  if (days < s.minDays) return null
  const gainKg = Math.max(0, weightAt(points, to) - points[0].kg)
  const milkKg = gainKg * s.factor
  return { from, to, days, gainKg, gainPerDay: (gainKg * 1000) / days, milkKg, milkPerDay: milkKg / days }
}

export interface DamMilk {
  /** Lämmer des letzten Wurfs mit Schätzung */
  lambs: number
  /** Lämmer des letzten Wurfs ohne (zu wenig Wägungen) */
  missing: number
  /** Milch aller geschätzten Lämmer im gerechneten Zeitraum, kg */
  totalKg: number
  /** mittlere Tagesmenge aller geschätzten Lämmer, kg/Tag */
  perDay: number
}

/** Je Mutter die Milch ihrer Lämmer des letzten Wurfs. */
export function milkByDam(lambs: Lamb[], s: LambMilkSettings, bucketFromOf: (l: Lamb) => string | null = (l) => l.bucketFrom ?? null): Map<string, DamMilk> {
  const lastBirth = new Map<string, string>()
  for (const l of lambs) if (l.damId && (lastBirth.get(l.damId) ?? '') < l.birthDate) lastBirth.set(l.damId, l.birthDate)
  const out = new Map<string, DamMilk>()
  for (const l of lambs) {
    if (!l.damId || l.birthDate !== lastBirth.get(l.damId)) continue
    const m = out.get(l.damId) ?? { lambs: 0, missing: 0, totalKg: 0, perDay: 0 }
    const e = lambMilk(l, s, bucketFromOf(l))
    if (e) {
      m.lambs++
      m.totalKg += e.milkKg
      m.perDay += e.milkPerDay
    } else m.missing++
    out.set(l.damId, m)
  }
  return out
}

export async function loadDamMilk(pg: PGlite, today: string, s: LambMilkSettings): Promise<Map<string, DamMilk>> {
  // der Eimer-Entscheid steht schon an jedem Lamm (lib/lambs.ts bucketFrom)
  return milkByDam(await loadLambs(pg, today), s)
}

/** Was die Lämmer heute bei der Mutter trinken — für die korrigierte Milchleistung der Mutter. */
export interface SucklingMilk {
  /** saugende Lämmer (bei der Mutter, nicht abgesetzt, nicht am Eimer) */
  lambs: number
  /** Lämmer am Eimer (bei der Mutter, saugen aber nicht): zählen nicht */
  bucket: number
  /** Milch aller saugenden Lämmer, kg/Tag */
  perDay: number
  /** davon so viele aus der Wägung der Lämmer (Zuwachs), die übrigen nach Vorgabe je Anzahl */
  weighed: number
  /** Alter des jüngsten saugenden Lamms (Tage), für das Absetzen */
  youngestAgeDays: number | null
}

/** Je Mutter die Milch, die ihre saugenden Lämmer heute trinken. Mit Wägung (Geburt/Ohrmarke und später) aus dem
 * Zuwachs, sonst nach Vorgabe: 1 / 2 / 3+ Lämmer trinken zusammen perDay1 / perDay2 / perDay3. Lämmer am Eimer zählen
 * nicht; eine Mutter nur mit Eimer-Lämmern bekommt keine Korrektur. */
export function sucklingMilkByDam(lambs: Lamb[], s: LambMilkSettings): Map<string, SucklingMilk> {
  const byDam = new Map<string, Lamb[]>()
  for (const l of lambs) if (l.damId && l.nursing) byDam.set(l.damId, [...(byDam.get(l.damId) ?? []), l])
  const out = new Map<string, SucklingMilk>()
  for (const [damId, list] of byDam) {
    const suckling = list.filter((l) => l.suckling)
    const n = suckling.length
    const total = n === 0 ? 0 : n === 1 ? s.perDay1 : n === 2 ? s.perDay2 : s.perDay3
    let perDay = 0
    let weighed = 0
    for (const l of suckling) {
      const e = lambMilk(l, s, l.bucketFrom)
      if (e) {
        perDay += e.milkPerDay
        weighed++
      } else perDay += total / n
    }
    out.set(damId, {
      lambs: n,
      bucket: list.length - n,
      perDay: Math.round(perDay * 100) / 100,
      weighed,
      youngestAgeDays: n > 0 ? Math.min(...suckling.map((l) => l.ageDays)) : null,
    })
  }
  return out
}

export function loadLambMilkSettings(moduleKey: string): LambMilkSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(`${moduleKey}_lamb_milk`) ?? 'null') as Partial<Record<keyof LambMilkSettings, unknown>> | null
    const out = { ...DEFAULT_LAMB_MILK }
    if (raw) for (const k of Object.keys(out) as (keyof LambMilkSettings)[]) {
      const v = Number(raw[k])
      if (raw[k] != null && Number.isFinite(v) && v > 0) out[k] = v
    }
    return out
  } catch {
    return DEFAULT_LAMB_MILK
  }
}

export function saveLambMilkSettings(moduleKey: string, s: LambMilkSettings): void {
  try {
    localStorage.setItem(`${moduleKey}_lamb_milk`, JSON.stringify(s))
  } catch {
    // nur bis zum Neuladen
  }
}
