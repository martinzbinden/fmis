import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIRECT_MARKETING,
  DEFAULT_MARKET_PRICES,
  directValue,
  estimateCarcassKg,
  laWeightDeduction,
  marketValue,
  parseGrade,
} from './marketing'

describe('parseGrade', () => {
  it('liest Fleischigkeit, Unterklasse und Fettklasse', () => {
    expect(parseGrade('T3+')).toEqual({ fleshiness: 'T', sub: 1, fat: 3 })
    expect(parseGrade('h', '4')).toEqual({ fleshiness: 'H', sub: 0, fat: 4 })
    expect(parseGrade('')).toEqual({ fleshiness: 'T', sub: 0, fat: 3 })
  })
})

describe('marketValue', () => {
  const prices = DEFAULT_MARKET_PRICES
  it('T3 ohne Abzug ist der Wochenpreis', () => {
    const r = marketValue(19, parseGrade('T3'), prices)
    expect(r.category).toBe('LA')
    expect(r.pricePerKg).toBeCloseTo(13.6)
    expect(r.revenue).toBeCloseTo(258.4 - 3.72)
  })
  it('T3+ liegt ein Drittel Richtung H', () => {
    expect(marketValue(19, parseGrade('T3+'), prices).pricePerKg).toBeCloseTo(13.733, 2)
  })
  it('schwere Lämmer: 4.00 Abzug zwischen 25 und 28 kg SG, darüber Schafpreis', () => {
    expect(laWeightDeduction(27.3)).toBe(4)
    expect(marketValue(27.3, parseGrade('T3'), prices).pricePerKg).toBeCloseTo(9.6)
    const heavy = marketValue(28.8, parseGrade('T3'), prices)
    expect(heavy.category).toBe('SM')
    expect(heavy.pricePerKg).toBeCloseTo(6.5)
  })
  it('Fettklasse 4 und 5 werden abgezogen', () => {
    expect(marketValue(19, parseGrade('T4'), prices).pricePerKg).toBeCloseTo(12.7)
  })
})

describe('estimateCarcassKg', () => {
  it('rechnet mit der Ausbeute nach Fleischigkeit', () => {
    expect(estimateCarcassKg(45, parseGrade('T3'))).toBeCloseTo(20.7)
  })
})

describe('directValue', () => {
  it('trifft die Schärer-Rechnung vom Juli 2026 (5 Lämmer, 136.6 kg SG, 922.40 exkl. MwSt)', () => {
    const r = directValue(136.6, { ...DEFAULT_DIRECT_MARKETING, vat_pct: 0 }, 5)
    expect(r.meatKg).toBeCloseTo(76.5, 1)
    expect(Math.abs(r.butcherCost - 922.4)).toBeLessThan(30)
  })
})
