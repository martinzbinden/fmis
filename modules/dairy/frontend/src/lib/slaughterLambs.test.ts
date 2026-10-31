import { describe, expect, it } from 'vitest'
import { DEFAULT_SLAUGHTER_SETTINGS as S, lambMaxMonths, slaughterValue } from './slaughterLambs'

describe('slaughterValue', () => {
  it('zählt bis 419 Tage als Lamm', () => {
    const v = slaughterValue('2025-10-01', '2026-11-24', S) // 419 Tage
    expect(v.ageDays).toBe(419)
    expect(v.isLamb).toBe(true)
    expect(v.lambUntil).toBe('2026-11-24')
    expect(v.daysLeftAsLamb).toBe(0)
    expect(v.revenue).toBe(294.8)
    expect(slaughterValue('2025-10-01', '2026-11-25', S).isLamb).toBe(false)
    expect(slaughterValue('2025-10-01', '2026-11-25', S).revenue).toBe(140.8)
  })
  it('vor 8 Monaten noch nicht schlachtreif', () => {
    const v = slaughterValue('2026-04-01', '2026-11-01', S)
    expect(v.ready).toBe(false)
    expect(v.revenue).toBeNull()
    expect(v.readyFrom).toBe('2026-12-01')
  })
  it('Altersgrenze für die Selektion deckt genau 419 Tage ab', () => {
    const days = lambMaxMonths(S) * 30.4375
    expect(days > 419 && days < 420).toBe(true)
  })
})
