import { describe, expect, it } from 'vitest'
import { jahreZurWahl, tagImJahr } from './jahrWahl'

describe('Jahreswahl der AGFF-Seiten', () => {
  it('bietet Jahre mit Daten, das laufende und das gewählte an', () => {
    expect(jahreZurWahl([2025, 2026, 2025, null], 2027, 2027)).toEqual([2025, 2026, 2027])
    expect(jahreZurWahl([], 2027, 2024)).toEqual([2024, 2027])
  })
  it('springt beim Wechsel auf denselben Tag im Jahr', () => {
    expect(tagImJahr('2027-01-05', 2026, '2027-01-05')).toBe('2026-01-05')
    expect(tagImJahr('2024-02-29', 2025, '2027-01-05')).toBe('2025-02-28')
    expect(tagImJahr('2026-06-01', 2027, '2027-01-05')).toBe('2027-01-05')
  })
})
