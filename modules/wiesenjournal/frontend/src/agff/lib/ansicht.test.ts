import { describe, expect, it } from 'vitest'
import { ansichtenReihenfolge, isoWoche, montag, vorgabeAnsicht } from './ansicht'

describe('Ansichten', () => {
  it('Vorgabe: Handy Heute, Desktop Raster', () => {
    expect(vorgabeAnsicht(false)).toBe('heute')
    expect(vorgabeAnsicht(true)).toBe('raster')
  })
  it('Menü: Startansicht zuerst, die übrigen in fester Reihenfolge', () => {
    expect(ansichtenReihenfolge('jahr').map((a) => a.key)).toEqual(['jahr', 'heute', 'raster'])
    expect(ansichtenReihenfolge('raster').map((a) => a.key)).toEqual(['raster', 'heute', 'jahr'])
  })
  it('ISO-Woche und Montag', () => {
    expect(isoWoche('2026-01-01')).toEqual([2026, 1])
    expect(isoWoche('2026-06-16')).toEqual([2026, 25])
    expect(isoWoche('2027-01-01')).toEqual([2026, 53])
    expect(isoWoche('2025-12-29')).toEqual([2026, 1])
    expect(montag('2026-06-16')).toBe('2026-06-15')
    expect(montag('2026-06-15')).toBe('2026-06-15')
  })
})
