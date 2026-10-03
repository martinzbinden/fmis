import { describe, expect, it } from 'vitest'
import { lactationTrend, levelSeries, type LactationLevel } from './lactationTrend'

const L = (nr: number, level: number, running = false, tests = 6): LactationLevel => ({ lactation_number: nr, level, running, tests })

describe('lactationTrend', () => {
  it('fallend über die letzten drei, Rückgänge in Folge', () => {
    const t = lactationTrend([L(1, 1.0), L(2, 1.12), L(3, 0.98), L(4, 0.84)])
    expect(t.direction).toBe('fallend')
    expect(t.slope).toBeCloseTo(-0.14)
    expect(t.fallingStreak).toBe(2)
    expect(levelSeries(t, 3)).toBe('112 → 98 → 84 %')
  })

  it('stabil bei kleinen Schwankungen', () => {
    const t = lactationTrend([L(1, 1.0), L(2, 1.03), L(3, 0.99)])
    expect(t.direction).toBe('stabil')
    expect(t.fallingStreak).toBe(0)
  })

  it('laufende zählt erst ab 3 Wägungen mit, wird aber eingeordnet', () => {
    const early = lactationTrend([L(1, 1.0), L(2, 1.1), L(3, 0.7, true, 2)])
    expect(early.direction).toBe('steigend')
    expect(early.running).toEqual({ level: 0.7, ownMean: 1.05, tests: 2 })
    const later = lactationTrend([L(1, 1.0), L(2, 1.1), L(3, 0.7, true, 4)])
    expect(later.direction).toBe('fallend')
    expect(later.fallingStreak).toBe(1)
  })

  it('eine Laktation: keine Tendenz', () => {
    const t = lactationTrend([L(1, 0.9)])
    expect(t.direction).toBeNull()
    expect(t.slope).toBeNull()
  })
})
