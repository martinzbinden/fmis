// Herdenbild Milch × Laktationstag: alle Tiere an einem Wägungstag, jedes
// an seinem Laktationstag, gegen die Herdenkurve (getestet).

import { daysBetween } from './format'
import { metricValue, parityGroup, referenceAt, type CurveMetric, type HerdReference, type ParityGroup, type TestPoint } from './lactationCurves'

/** Wägungstage der Herde, neueste zuerst; Einzelwägungen (Nachkontrollen)
 * erst ab `minAnimals` Tieren. */
export function weighingDays(tests: TestPoint[], minAnimals = 3): { date: string; n: number }[] {
  const n = new Map<string, number>()
  for (const t of tests) n.set(t.test_date, (n.get(t.test_date) ?? 0) + 1)
  return [...n]
    .filter(([, c]) => c >= minAnimals)
    .map(([date, c]) => ({ date, n: c }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export type SnapshotPosition = 'hoch' | 'mitte' | 'tief' | null

export interface SnapshotPoint {
  animal_id: string
  lactation_number: number
  group: ParityGroup
  dim: number
  value: number
  /** gegenüber der mittleren Hälfte der Herde (Jahrgang, Laktationsgruppe, Abschnitt) */
  position: SnapshotPosition
  /** Median der Herde an dieser Stelle */
  herdMedian: number | null
}

export function herdSnapshot(tests: TestPoint[], date: string, metric: CurveMetric, ref: HerdReference): SnapshotPoint[] {
  const out: SnapshotPoint[] = []
  for (const t of tests) {
    if (t.test_date !== date) continue
    const value = metricValue(t, metric)
    const dim = daysBetween(t.calving_date, t.test_date)
    if (value == null || dim < 0) continue
    const group = parityGroup(t.lactation_number)
    const b = referenceAt(ref, group, dim, t.calving_date)
    out.push({
      animal_id: t.animal_id,
      lactation_number: t.lactation_number,
      group,
      dim,
      value,
      position: b ? (value > b.q3 ? 'hoch' : value < b.q1 ? 'tief' : 'mitte') : null,
      herdMedian: b?.median ?? null,
    })
  }
  return out
}
