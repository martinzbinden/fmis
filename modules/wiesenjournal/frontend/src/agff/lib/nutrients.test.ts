import { describe, expect, it } from 'vitest'
import { computeNutrients, kgPerHa, parseDilution } from './nutrients'
import type { FertilizerType } from '../types'

const RGv = {
  id: 'x', code: 'RGv', name: 'Rindergülle verdünnt 1:1', unit: 'm3', n_kg_per_unit: 2.3, n_avail_pct: 60,
  p2o5_kg_per_unit: 0.9, k2o_kg_per_unit: 3.5, mg_kg_per_unit: 0.4, dilution_default: 0.5,
} as FertilizerType

describe('Nährstoffe', () => {
  it('Verdünnung lesen', () => {
    expect(parseDilution('1:1')).toBe(0.5)
    expect(parseDilution('3:1')).toBe(0.75)
    expect(parseDilution(' 1 : 3 ')).toBe(0.25)
    expect(parseDilution('abc')).toBeNull()
    expect(parseDilution('')).toBeNull()
  })
  it('Menge × Gehalt, Verdünnung relativ zum Standard', () => {
    expect(computeNutrients(19.5, RGv, null)).toEqual({ n_kg: 44.85, n_avail_kg: 26.91, p2o5_kg: 17.55, k2o_kg: 68.25 })
    // 3:1 statt 1:1 → 1.5× so viel je m³
    expect(computeNutrients(10, RGv, 0.75).n_kg).toBe(34.5)
    expect(computeNutrients(null, RGv, null).n_kg).toBeNull()
  })
  it('kg/ha aus Aren', () => {
    expect(kgPerHa(50, 100)).toBe(50)
    expect(kgPerHa(50, 50)).toBe(100)
    expect(kgPerHa(50, 0)).toBeNull()
  })
})
