import { afterEach, describe, expect, it, vi } from 'vitest'
import { localDateOf, localTodayIso } from './dates'

describe('localTodayIso', () => {
  afterEach(() => vi.useRealTimers())

  it('nach Mitternacht Schweizer Zeit ist schon der neue Tag', () => {
    // 2026-10-15 23:30 UTC = 2026-10-16 01:30 in Zürich (Sommerzeit)
    const now = new Date('2026-10-15T23:30:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(localTodayIso()).toBe(expected)
    if (process.env.TZ === 'Europe/Zurich') expect(localTodayIso()).toBe('2026-10-16')
  })

  it('lokaler Tag eines Zeitpunkts', () => {
    expect(localDateOf(new Date(2026, 0, 5, 0, 15))).toBe('2026-01-05')
  })
})
