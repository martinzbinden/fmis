import { describe, expect, it } from 'vitest'
import { lactationDayAt } from './lactationDay'

describe('lactationDayAt', () => {
  it('zählt die Tage seit der Abkalbung; Abkalbetag ist Tag 0', () => {
    expect(lactationDayAt('2026-09-01', '2026-09-01')).toBe(0)
    expect(lactationDayAt('2026-09-01', '2026-09-26')).toBe(25)
    expect(lactationDayAt('2025-12-31', '2026-01-02')).toBe(2)
  })

  it('ohne Datum oder mit Abkalbung nach der Wägung: null', () => {
    expect(lactationDayAt(null, '2026-09-26')).toBeNull()
    expect(lactationDayAt('2026-09-01', undefined)).toBeNull()
    expect(lactationDayAt('2026-10-01', '2026-09-26')).toBeNull()
  })
})
