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
}

export const DEFAULT_LAMB_MILK: LambMilkSettings = { factor: 5, maxDays: 35, minDays: 7 }

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
export function milkByDam(lambs: Lamb[], s: LambMilkSettings, bucketFromOf: (l: Lamb) => string | null = () => null): Map<string, DamMilk> {
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
  const [lambs, decisions] = await Promise.all([
    loadLambs(pg, today),
    pg.query<{ offspring_id: string | null; animal_id: string | null; decided_on: unknown }>(
      "select offspring_id, animal_id, decided_on from stall_decisions where deleted_at is null and step = 'eimer' and decision = 'eimer' order by decided_on",
    ),
  ])
  const bucket = new Map<string, string>()
  for (const d of decisions.rows) {
    const day = isoDate(d.decided_on)
    if (!day) continue
    for (const k of [d.offspring_id, d.animal_id]) if (k && !bucket.has(k)) bucket.set(k, day)
  }
  return milkByDam(lambs, s, (l) => (l.offspringId && bucket.get(l.offspringId)) || (l.animalId && bucket.get(l.animalId)) || null)
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
