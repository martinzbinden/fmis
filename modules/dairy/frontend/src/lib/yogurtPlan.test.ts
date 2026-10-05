import { describe, expect, it } from 'vitest'
import { exclusion, suggestYogurt, yogurtMix, type YogurtCow, type YogurtOptions } from './yogurtPlan'

const cow = (id: string, milk: number, fat: number | null, prot: number | null, scc: number | null, extra: Partial<YogurtCow> = {}): YogurtCow => ({
  animal_id: id,
  label: id,
  test_date: '2026-09-22',
  milk_kg: milk,
  fat_pct: fat,
  protein_pct: prot,
  cell_count: scc,
  analysis_date: null,
  dry: false,
  withdrawal_until: null,
  ...extra,
})

const herd = [
  cow('a', 20, 4.2, 3.9, 80),
  cow('b', 30, 4.0, 3.5, 60),
  cow('c', 25, 4.6, 3.8, 300),
  cow('d', 15, 3.9, 3.6, 40),
  cow('e', 28, 4.1, 4.0, 90, { withdrawal_until: '2026-10-08' }),
  cow('f', 22, 4.0, 3.7, 70, { dry: true }),
  cow('g', 18, null, null, null),
]
const opts: YogurtOptions = { targetKg: 60, factor: 1, criterion: 'eiweiss', maxCellCount: 250 }

describe('yogurtPlan', () => {
  it('sperrt Absetzfrist und trocken, lässt ohne Analyse/hohe Zellzahl von Hand zu', () => {
    expect(exclusion(herd[4], opts, '2026-10-05')).toEqual({ reason: 'Absetzfrist bis 2026-10-08', blocked: true })
    expect(exclusion(herd[4], opts, '2026-10-09')).toBeNull()
    expect(exclusion(herd[5], opts, '2026-10-05')?.blocked).toBe(true)
    expect(exclusion(herd[6], opts, '2026-10-05')).toEqual({ reason: 'ohne Laboranalyse', blocked: false })
    expect(exclusion(herd[2], opts, '2026-10-05')?.reason).toBe('Zellzahl zu hoch')
  })

  it('Vorschlag nach Eiweiss bis zur Menge: a (3.9) → d (3.6) → b (3.5)', () => {
    expect(suggestYogurt(herd, opts, '2026-10-05')).toEqual(['a', 'd', 'b'])
    // ein Gemelk: halbe Menge je Kuh
    expect(suggestYogurt(herd, { ...opts, targetKg: 15 }, '2026-10-05')).toEqual(['a'])
    expect(suggestYogurt(herd, { ...opts, targetKg: 15, factor: 0.5 }, '2026-10-05')).toEqual(['a', 'd'])
    // tiefste Zellzahl
    expect(suggestYogurt(herd, { ...opts, criterion: 'zellzahl', targetKg: 40 }, '2026-10-05')).toEqual(['d', 'b'])
  })

  it('Mischmilch mengengewichtet, Milch ohne Gehalte ausgewiesen', () => {
    const m = yogurtMix([herd[0], herd[1], herd[6]], 1)
    expect(m.milkKg).toBe(68)
    expect(m.proteinPct).toBeCloseTo((20 * 3.9 + 30 * 3.5) / 50, 6)
    expect(m.fatPct).toBeCloseTo((20 * 4.2 + 30 * 4.0) / 50, 6)
    expect(m.cellCount).toBeCloseTo((20 * 80 + 30 * 60) / 50, 6)
    expect(m.unknownKg).toBe(18)
    expect(yogurtMix([], 1)).toMatchObject({ n: 0, milkKg: 0, proteinPct: null })
  })
})
