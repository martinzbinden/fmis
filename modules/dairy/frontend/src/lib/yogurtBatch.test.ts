import { describe, expect, it } from 'vitest'
import { batchPreview, toggleMilked } from './yogurtBatch'
import type { YogurtCow } from './yogurtPlan'

const cow = (id: string, milk: number, prot: number): YogurtCow => ({
  animal_id: id,
  label: `Kuh ${id}`,
  test_date: '2026-01-10',
  milk_kg: milk,
  fat_pct: 4,
  protein_pct: prot,
  cell_count: 50,
  analysis_date: null,
  dry: false,
  withdrawal_until: null,
})
const cows = [cow('a', 10, 4), cow('b', 20, 3), cow('c', 5, 5)]

describe('toggleMilked', () => {
  it('markiert gemolken und nimmt eine nicht vorgeschlagene Kuh in die Auswahl', () => {
    expect(toggleMilked({ picked: ['a'], milked: [] }, 'c')).toEqual({ picked: ['a', 'c'], milked: ['c'] })
  })
  it('zweiter langer Druck nimmt die Markierung weg, die Auswahl bleibt', () => {
    expect(toggleMilked({ picked: ['a', 'c'], milked: ['c'] }, 'c')).toEqual({ picked: ['a', 'c'], milked: [] })
  })
})

describe('batchPreview', () => {
  it('ohne Markierung gilt die ganze Auswahl', () => {
    const p = batchPreview(cows, { picked: ['a', 'b'], suggested: ['a', 'b'], milked: [] }, 1)
    expect(p.assumedAll).toBe(true)
    expect(p.cows.map((c) => c.animal_id)).toEqual(['a', 'b'])
    expect(p.mix.milkKg).toBe(30)
    expect(p.notMilked).toEqual([])
  })
  it('mit Markierungen zählen nur die gemolkenen, dazugemolkene werden ausgewiesen', () => {
    const p = batchPreview(cows, { picked: ['a', 'b', 'c'], suggested: ['a', 'b'], milked: ['a', 'c'] }, 0.5)
    expect(p.cows.map((c) => c.animal_id)).toEqual(['a', 'c'])
    expect(p.mix.milkKg).toBe(7.5)
    expect(p.extra.map((c) => c.animal_id)).toEqual(['c'])
    expect(p.notMilked.map((c) => c.animal_id)).toEqual(['b'])
  })
})
