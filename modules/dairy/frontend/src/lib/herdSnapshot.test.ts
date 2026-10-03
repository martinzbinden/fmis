import { describe, expect, it } from 'vitest'
import { buildHerdReference, type TestPoint } from './lactationCurves'
import { herdSnapshot, weighingDays } from './herdSnapshot'

const t = (animal: string, calving: string, test: string, milk: number, lact = 2): TestPoint => ({
  animal_id: animal,
  lactation_number: lact,
  calving_date: calving,
  test_date: test,
  milk_kg: milk,
  fat_pct: 6,
  protein_pct: 5,
})

// 8 Tiere, alle gleich gekalbt, am 25.9. zwischen 1.0 und 2.4 kg
const tests: TestPoint[] = [
  ...Array.from({ length: 8 }, (_, i) => t(`a${i}`, '2026-06-01', '2026-09-25', 1.0 + i * 0.2)),
  ...Array.from({ length: 8 }, (_, i) => t(`a${i}`, '2026-06-01', '2026-08-28', 1.5 + i * 0.2)),
  t('x', '2026-05-01', '2026-09-27', 1.8),
]

describe('herdSnapshot', () => {
  it('Wägungstage, neueste zuerst, Einzelwägungen weg', () => {
    expect(weighingDays(tests)).toEqual([
      { date: '2026-09-25', n: 8 },
      { date: '2026-08-28', n: 8 },
    ])
  })

  it('Tiere am Wägungstag mit Laktationstag und Lage zur Herde', () => {
    const ref = buildHerdReference(tests, 'milk')
    const pts = herdSnapshot(tests, '2026-09-25', 'milk', ref)
    expect(pts).toHaveLength(8)
    expect(pts[0]).toMatchObject({ animal_id: 'a0', dim: 116, value: 1.0, group: 2, position: 'tief' })
    expect(pts[7].position).toBe('hoch')
    expect(pts[7].value).toBeCloseTo(2.4, 5)
    expect(pts.filter((p) => p.position === 'mitte').length).toBeGreaterThan(0)
  })

  it('F+E aus Milch × Gehalt', () => {
    const ref = buildHerdReference(tests, 'fe')
    const [p] = herdSnapshot(tests, '2026-09-25', 'fe', ref)
    expect(p.value).toBeCloseTo(0.11, 5)
  })
})
