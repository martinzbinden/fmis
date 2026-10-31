import { describe, expect, it } from 'vitest'
import { bestIndex, DEFAULT_GROUP_SETTINGS, slaughterRevenue } from './groupCompare'

describe('Gruppenvergleich', () => {
  const s = DEFAULT_GROUP_SETTINGS.sheep
  it('Lamm ab 8 Monaten: 22 kg × 13.40, jünger ohne Erlös', () => {
    expect(slaughterRevenue('2026-01-01', '2026-10-31', s)).toEqual({ young: true, revenue: 294.8 })
    expect(slaughterRevenue('2026-05-01', '2026-10-31', s).revenue).toBeNull()
  })
  it('Aue: ohne Schlachtgewicht kein Erlös, mit Gewicht SM-Preis', () => {
    expect(slaughterRevenue('2022-01-01', '2026-10-31', s)).toEqual({ young: false, revenue: null })
    expect(slaughterRevenue('2022-01-01', '2026-10-31', { ...s, carcassAdult: 30 }).revenue).toBe(192)
  })
  it('bester Wert je Zeile, nur bei mind. zwei Werten und eindeutig', () => {
    expect(bestIndex([100, 104, null], 'high')).toBe(1)
    expect(bestIndex([300, 280], 'low')).toBe(1)
    expect(bestIndex([5, 5], 'high')).toBeNull()
    expect(bestIndex([5, null], 'high')).toBeNull()
    expect(bestIndex([1, 2], null)).toBeNull()
  })
})
