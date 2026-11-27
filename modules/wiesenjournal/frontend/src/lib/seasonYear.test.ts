import { describe, expect, it } from 'vitest'
import { parseSeasonYear, seasonYearOptions } from './seasonYear'

describe('Saison der klassischen Seiten', () => {
  it('liest ?jahr= nur als gültiges Jahr', () => {
    expect(parseSeasonYear('2025')).toBe(2025)
    expect(parseSeasonYear('abc')).toBeNull()
    expect(parseSeasonYear(null)).toBeNull()
    expect(parseSeasonYear('1999')).toBeNull()
  })
  it('bietet Jahre aus den Daten plus laufendes und nächstes an', () => {
    expect(seasonYearOptions([2022, 2026, 2026], 2026, 2026)).toEqual([2027, 2026, 2022])
    expect(seasonYearOptions([], 2027, 2024)).toEqual([2028, 2027, 2024])
  })
})
