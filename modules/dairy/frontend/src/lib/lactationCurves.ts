// Laktationskurven im Herdenvergleich (pages/Milk.tsx → components/
// LactationView.tsx).
//
// Bewertung mit einem einfachen Testtag-Modell, wie in der Zuchtwertschätzung:
// Wägung ≈ Testtag × Kurvenform(Laktationstag, Erstling/älter) × Tier. Der
// Testtag-Faktor nimmt alles heraus, was die ganze Herde am selben Tag
// trifft — Jahr, Saison, Futter, Trockenheit (Schafe 2026: Juni 1.5 kg,
// September 0.7 kg bei allen gleichzeitig). Übrig bleibt der Tieranteil:
// rel = Wägung / (Testtag × Kurvenform), 1 = wie die Herde.
//
// Für die Anzeige in kg gibt es zusätzlich die Herdenkurve je Jahrgang:
// - Herdenkurve: je 30-Tage-Abschnitt nach der Geburt Median und mittlere
//   Hälfte (Viertel 1–3) der Wägungen, Erstlinge und ältere getrennt, und
//   je Geburtsjahrgang: Futter, Wetter und Betrieb ändern sich von Jahr zu
//   Jahr stark (Schafe Tag 30–90: 2022 3.0 kg, 2026 1.95 kg) — verglichen
//   wird mit den Tieren, die im gleichen Jahr geboren haben. Abschnitte mit
//   zu wenig Wägungen nehmen die Kurve aller Jahre, auf das Niveau des
//   Jahrgangs skaliert.
// - Niveau einer Laktation: Mittel der Wägungen in % des Herdenmedians.
// - Persistenz: wie sich diese Prozente im Verlauf ändern (lineare
//   Regression, Änderung je 100 Tage: −0.10 = −10 Prozentpunkte). 0 = Kurve
//   verläuft wie die Herde; negativ = fällt nach dem Höhepunkt stärker ab.
// Reine Funktionen (getestet).

import { daysBetween } from './format'

export type CurveMetric = 'milk' | 'fe'

export interface TestPoint {
  animal_id: string
  lactation_number: number
  calving_date: string
  test_date: string
  milk_kg: number
  fat_pct: number | null
  protein_pct: number | null
}

export const BLOCK_DAYS = 30
/** Ab Tag 270 ein gemeinsamer Abschnitt (wenige Wägungen). */
export const LAST_BLOCK = 9
const MIN_PER_BLOCK = 8
const MAX_DIM = 400

export type ParityGroup = 1 | 2
export const parityGroup = (lactationNumber: number): ParityGroup => (lactationNumber <= 1 ? 1 : 2)
export const PARITY_GROUP_LABEL: Record<ParityGroup, string> = { 1: 'Erstlinge', 2: 'ab 2. Laktation' }

export function metricValue(t: Pick<TestPoint, 'milk_kg' | 'fat_pct' | 'protein_pct'>, metric: CurveMetric): number | null {
  if (metric === 'milk') return t.milk_kg
  if (t.fat_pct == null || t.protein_pct == null) return null
  return (t.milk_kg * (t.fat_pct + t.protein_pct)) / 100
}

const blockOf = (dim: number) => Math.min(LAST_BLOCK, Math.floor(dim / BLOCK_DAYS))

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export interface BandBlock {
  block: number
  /** Mitte des Abschnitts in Tagen, für die Grafik. */
  mid: number
  n: number
  q1: number
  median: number
  q3: number
  /** Werte vom Nachbarabschnitt übernommen (zu wenige Wägungen). */
  borrowed: boolean
}

export interface HerdReference {
  metric: CurveMetric
  /** alle Jahrgänge zusammen */
  groups: Record<ParityGroup, BandBlock[]>
  /** je Geburtsjahr (YYYY) */
  byYear: Map<string, Record<ParityGroup, BandBlock[]>>
}

const emptyBlocks = (): number[][] => Array.from({ length: LAST_BLOCK + 1 }, () => [])

export function buildHerdReference(tests: TestPoint[], metric: CurveMetric): HerdReference {
  const values: Record<ParityGroup, number[][]> = { 1: emptyBlocks(), 2: emptyBlocks() }
  const yearValues = new Map<string, Record<ParityGroup, number[][]>>()
  for (const t of tests) {
    const dim = daysBetween(t.calving_date, t.test_date)
    const v = metricValue(t, metric)
    if (v == null || dim < 0 || dim > MAX_DIM) continue
    const g = parityGroup(t.lactation_number)
    values[g][blockOf(dim)].push(v)
    const year = t.calving_date.slice(0, 4)
    if (!yearValues.has(year)) yearValues.set(year, { 1: emptyBlocks(), 2: emptyBlocks() })
    yearValues.get(year)![g][blockOf(dim)].push(v)
  }
  const build = (lists: number[][]): BandBlock[] => {
    const own = lists.map((vals, block) => {
      const sorted = [...vals].sort((a, b) => a - b)
      return sorted.length >= MIN_PER_BLOCK
        ? { block, mid: block * BLOCK_DAYS + BLOCK_DAYS / 2, n: sorted.length, q1: quantile(sorted, 0.25), median: quantile(sorted, 0.5), q3: quantile(sorted, 0.75), borrowed: false }
        : null
    })
    return own.map((b, block) => {
      if (b) return b
      // nächster Abschnitt mit genug Wägungen, bei Gleichstand der frühere
      for (let d = 1; d <= LAST_BLOCK; d++) {
        const near = own[block - d] ?? own[block + d]
        if (near) return { ...near, block, mid: block * BLOCK_DAYS + BLOCK_DAYS / 2, n: lists[block].length, borrowed: true }
      }
      return { block, mid: block * BLOCK_DAYS + BLOCK_DAYS / 2, n: 0, q1: NaN, median: NaN, q3: NaN, borrowed: true }
    })
  }
  const g1 = build(values[1])
  const g2 = build(values[2])
  // Zu wenige Erstlinge insgesamt: deren Kurve aus allen Tieren.
  const enoughFirst = values[1].reduce((s, v) => s + v.length, 0) >= MIN_PER_BLOCK * 3
  const groups: Record<ParityGroup, BandBlock[]> = { 1: enoughFirst ? g1 : build(values[1].map((v, i) => [...v, ...values[2][i]])), 2: g2 }

  // Jahrgang: eigene Abschnitte mit genug Wägungen, sonst Kurve aller Jahre ×
  // Jahresfaktor (Median der Verhältnisse Jahrgang / alle Jahre über die
  // Abschnitte, in denen beide genug Wägungen haben, beide Gruppen zusammen).
  const allCombined = values[1].map((v, i) => [...v, ...values[2][i]].sort((a, b) => a - b))
  const byYear = new Map<string, Record<ParityGroup, BandBlock[]>>()
  for (const [year, yv] of yearValues) {
    const ratios: number[] = []
    yv[1].forEach((v, i) => {
      const combined = [...v, ...yv[2][i]].sort((a, b) => a - b)
      if (combined.length >= MIN_PER_BLOCK && allCombined[i].length >= MIN_PER_BLOCK) ratios.push(quantile(combined, 0.5) / quantile(allCombined[i], 0.5))
    })
    const factor = ratios.length ? quantile(ratios.sort((a, b) => a - b), 0.5) : 1
    const forGroup = (g: ParityGroup): BandBlock[] =>
      groups[g].map((base, block) => {
        const sorted = [...yv[g][block]].sort((a, b) => a - b)
        if (sorted.length >= MIN_PER_BLOCK)
          return { block, mid: base.mid, n: sorted.length, q1: quantile(sorted, 0.25), median: quantile(sorted, 0.5), q3: quantile(sorted, 0.75), borrowed: false }
        return { ...base, n: sorted.length, q1: base.q1 * factor, median: base.median * factor, q3: base.q3 * factor, borrowed: true }
      })
    byYear.set(year, { 1: forGroup(1), 2: forGroup(2) })
  }
  return { metric, groups, byYear }
}

/** Herdenkurve für eine Laktation: Jahrgang der Geburt, sonst alle Jahre. */
export function bandFor(ref: HerdReference, calvingDate: string | null, group: ParityGroup): BandBlock[] {
  return (calvingDate && ref.byYear.get(calvingDate.slice(0, 4))?.[group]) || ref.groups[group]
}

export function referenceAt(ref: HerdReference, group: ParityGroup, dim: number, calvingDate: string | null = null): BandBlock | null {
  const b = bandFor(ref, calvingDate, group)[blockOf(Math.max(0, dim))]
  return b && Number.isFinite(b.median) && b.median > 0 ? b : null
}

export interface CurvePoint {
  dim: number
  test_date: string
  value: number
  /** Tieranteil: Wert / (Testtag × Kurvenform), 1 = wie die Herde. */
  rel: number
  /** Zählt nicht für Niveau und Persistenz (erste Wägungen, Säugezeit). */
  excluded: boolean
}

export interface LactationCurve {
  animal_id: string
  lactation_number: number
  calving_date: string
  group: ParityGroup
  points: CurvePoint[]
  /** Mittel der rel-Werte (1 = Herdenmedian); ab 2 Wägungen. */
  level: number | null
  /** Änderung von rel je 100 Tage (−0.1 = −10 Prozentpunkte); ab 3 Wägungen über mind. 60 Tage. */
  persistence: number | null
  lastDim: number | null
}

export const curveKey = (animalId: string, lactationNumber: number) => `${animalId}|${lactationNumber}`

const median = (vals: number[]) => quantile([...vals].sort((a, b) => a - b), 0.5)
const MIN_PER_TESTDAY = 5

export interface TestDayModel {
  metric: CurveMetric
  /** Kurvenform je Gruppe und Abschnitt (kg bei Testtag-Faktor 1). */
  shape: Record<ParityGroup, number[]>
  /** Testtag (Datum bzw. Monat bei wenigen Wägungen) → Faktor. */
  testDay: Map<string, number>
  /** Verteilung der rel-Werte je Gruppe und Abschnitt (Median ≈ 1). */
  relBand: Record<ParityGroup, BandBlock[]>
}

/** Faktoren schätzen: abwechselnd Testtag und Kurvenform als Mediane der
 * jeweils bereinigten Wägungen (robust gegen Ausreisser), 8 Runden. */
export function buildTestDayModel(tests: TestPoint[], metric: CurveMetric): TestDayModel {
  const perDate = new Map<string, number>()
  for (const t of tests) perDate.set(t.test_date, (perDate.get(t.test_date) ?? 0) + 1)
  const obs = tests
    .map((t) => {
      const dim = daysBetween(t.calving_date, t.test_date)
      const v = metricValue(t, metric)
      if (v == null || v <= 0 || dim < 0 || dim > MAX_DIM) return null
      const day = (perDate.get(t.test_date) ?? 0) >= MIN_PER_TESTDAY ? t.test_date : t.test_date.slice(0, 7)
      return { t, v, dim, g: parityGroup(t.lactation_number), b: blockOf(dim), day }
    })
    .filter((o): o is NonNullable<typeof o> => o != null)

  const shape: Record<ParityGroup, number[]> = { 1: [], 2: [] }
  const fillShape = (valueOf: (o: (typeof obs)[number]) => number) => {
    for (const g of [1, 2] as ParityGroup[]) {
      shape[g] = Array.from({ length: LAST_BLOCK + 1 }, (_, b) => {
        const vals = obs.filter((o) => o.g === g && o.b === b).map(valueOf)
        return vals.length >= MIN_PER_BLOCK ? median(vals) : NaN
      })
    }
    // Lücken: Erstlinge aus den älteren (mit mittlerem Verhältnis), sonst Nachbarabschnitt
    const ratios = shape[1].map((v, b) => v / shape[2][b]).filter(Number.isFinite)
    const r = ratios.length ? median(ratios) : 1
    shape[1] = shape[1].map((v, b) => (Number.isFinite(v) ? v : shape[2][b] * r))
    for (const g of [1, 2] as ParityGroup[]) {
      shape[g] = shape[g].map((v, b, arr) => {
        if (Number.isFinite(v)) return v
        for (let d = 1; d <= LAST_BLOCK; d++) {
          const near = arr[b - d] ?? arr[b + d]
          if (near != null && Number.isFinite(near)) return near
        }
        return 1
      })
    }
  }
  const testDay = new Map<string, number>()
  fillShape((o) => o.v)
  for (let round = 0; round < 8; round++) {
    const byDay = new Map<string, number[]>()
    for (const o of obs) byDay.set(o.day, [...(byDay.get(o.day) ?? []), o.v / shape[o.g][o.b]])
    for (const [day, vals] of byDay) testDay.set(day, median(vals))
    fillShape((o) => o.v / (testDay.get(o.day) ?? 1))
  }

  const rels: Record<ParityGroup, number[][]> = { 1: emptyBlocks(), 2: emptyBlocks() }
  for (const o of obs) rels[o.g][o.b].push(o.v / ((testDay.get(o.day) ?? 1) * shape[o.g][o.b]))
  const relBand = {} as Record<ParityGroup, BandBlock[]>
  for (const g of [1, 2] as ParityGroup[]) {
    relBand[g] = rels[g].map((vals, block) => {
      const sorted = [...vals].sort((a, b) => a - b)
      const ok = sorted.length >= MIN_PER_BLOCK
      return {
        block,
        mid: block * BLOCK_DAYS + BLOCK_DAYS / 2,
        n: sorted.length,
        q1: ok ? quantile(sorted, 0.25) : NaN,
        median: ok ? quantile(sorted, 0.5) : NaN,
        q3: ok ? quantile(sorted, 0.75) : NaN,
        borrowed: !ok,
      }
    })
  }
  return { metric, shape, testDay, relBand }
}

/** Testtag-Schlüssel wie im Modell: Datum, bei wenigen Wägungen der Monat. */
function testDayFactor(model: TestDayModel, testDate: string): number | null {
  return model.testDay.get(testDate) ?? model.testDay.get(testDate.slice(0, 7)) ?? null
}

/** Steigung der Regressionsgeraden y über x. */
export function slope(xs: number[], ys: number[]): number | null {
  if (xs.length < 2) return null
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length
  const my = ys.reduce((s, v) => s + v, 0) / ys.length
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  return den === 0 ? null : num / den
}

/** skipFirst: so viele erste Wägungen je Laktation zählen nicht für Niveau
 * und Persistenz — um Tag 30 saugen oft noch die Lämmer, die Wägung sagt
 * dann wenig über das Tier (bleiben in der Kurve sichtbar). */
export function analyzeLactations(tests: TestPoint[], model: TestDayModel, skipFirst = 0): Map<string, LactationCurve> {
  const byLactation = new Map<string, TestPoint[]>()
  for (const t of tests) {
    const key = curveKey(t.animal_id, t.lactation_number)
    byLactation.set(key, [...(byLactation.get(key) ?? []), t])
  }
  const out = new Map<string, LactationCurve>()
  for (const [key, list] of byLactation) {
    const first = list[0]
    const group = parityGroup(first.lactation_number)
    const points: CurvePoint[] = []
    for (const t of [...list].sort((a, b) => a.test_date.localeCompare(b.test_date))) {
      const dim = daysBetween(t.calving_date, t.test_date)
      const value = metricValue(t, model.metric)
      const td = testDayFactor(model, t.test_date)
      if (value == null || value <= 0 || dim < 0 || dim > MAX_DIM || td == null) continue
      points.push({ dim, test_date: t.test_date, value, rel: value / (td * model.shape[group][blockOf(dim)]), excluded: points.length < skipFirst })
    }
    const used = points.filter((p) => !p.excluded)
    const level = used.length >= 2 ? used.reduce((s, p) => s + p.rel, 0) / used.length : null
    const span = used.length ? used[used.length - 1].dim - used[0].dim : 0
    const raw = used.length >= 3 && span >= 60 ? slope(used.map((p) => p.dim), used.map((p) => p.rel)) : null
    out.set(key, {
      animal_id: first.animal_id,
      lactation_number: first.lactation_number,
      calving_date: first.calving_date,
      group,
      points,
      level,
      persistence: raw == null ? null : raw * 100,
      lastDim: points.length ? points[points.length - 1].dim : null,
    })
  }
  return out
}

/** Erwartete Gesamtmenge bei Herdenverlauf: Tagesmengen der Herdenkurve
 * (Median je Abschnitt) über `days` Melktage aufsummiert. */
export function expectedTotal(band: BandBlock[], days: number): number | null {
  let total = 0
  for (let d = 0; d < days; d += BLOCK_DAYS) {
    const b = band[blockOf(d)]
    if (!b || !Number.isFinite(b.median)) return null
    total += b.median * Math.min(BLOCK_DAYS, days - d)
  }
  return total
}

/** Grenzen der Viertel (25/50/75 %) über alle bewerteten Laktationen. */
export function quartileBounds(levels: number[]): [number, number, number] | null {
  const sorted = levels.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length < 4) return null
  return [quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75)]
}

/** 4 = oberstes Viertel der Herde, 1 = unterstes. */
export function quartileOf(level: number | null, bounds: [number, number, number] | null): 1 | 2 | 3 | 4 | null {
  if (level == null || !bounds) return null
  return level >= bounds[2] ? 4 : level >= bounds[1] ? 3 : level >= bounds[0] ? 2 : 1
}

export type CurveClass = 'hoch_ausdauernd' | 'hoch_abfallend' | 'tief_ausdauernd' | 'tief_abfallend'

export const CURVE_CLASS_LABEL: Record<CurveClass, string> = {
  hoch_ausdauernd: 'hoch & ausdauernd',
  hoch_abfallend: 'hoch, fällt ab',
  tief_ausdauernd: 'tief, ausdauernd',
  tief_abfallend: 'tief & fällt ab',
}

/** Hoch = über dem Herdenmedian; ausdauernd = fällt nicht stärker ab als die Herde. */
export function curveClass(c: Pick<LactationCurve, 'level' | 'persistence'> | undefined): CurveClass | null {
  if (!c || c.level == null || c.persistence == null) return null
  const high = c.level >= 1
  const lasting = c.persistence >= 0
  return high ? (lasting ? 'hoch_ausdauernd' : 'hoch_abfallend') : lasting ? 'tief_ausdauernd' : 'tief_abfallend'
}
