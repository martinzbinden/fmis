import { describe, expect, it } from 'vitest'
import { measuredAtLabel } from './measuredAt'

describe('measuredAtLabel', () => {
  const now = new Date(2026, 10, 27, 15, 0)
  it('heute nur die Uhrzeit', () => {
    expect(measuredAtLabel(new Date(2026, 10, 27, 9, 5).toISOString(), now)).toBe('09:05')
  })
  it('früher mit Datum, anderes Jahr mit Jahr', () => {
    expect(measuredAtLabel(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe('03.11. 09:05')
    expect(measuredAtLabel(new Date(2025, 0, 2, 18, 30).toISOString(), now)).toBe('02.01.2025 18:30')
  })
  it('unlesbar: leer', () => {
    expect(measuredAtLabel('kein Datum', now)).toBe('')
  })
})
