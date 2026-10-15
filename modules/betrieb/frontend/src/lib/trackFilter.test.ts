import { describe, expect, it } from 'vitest'
import { acceptFix, gapDecision, pointsFromTrack } from './trackFilter'

const p = (northM: number, t: number) => ({ lat: 47 + northM / 111195, lng: 7.5, timestamp: t })

describe('acceptFix', () => {
  it('ungenau, Sprung, doppelt, normal', () => {
    expect(acceptFix(null, p(0, 0), 40)).toEqual({ ok: false, reason: 'ungenau' })
    expect(acceptFix(p(0, 0), p(3, 1000), 4)).toEqual({ ok: true })
    expect(acceptFix(p(0, 0), p(60, 1000), 4)).toEqual({ ok: false, reason: 'sprung' })
    expect(acceptFix(p(0, 1000), p(1, 1000), 4)).toEqual({ ok: false, reason: 'doppelt' })
    // nach langem Unterbruch kein Sprungtest
    expect(acceptFix(p(0, 0), p(2000, 120_000), 4)).toEqual({ ok: true })
  })
})

describe('gapDecision', () => {
  it('kurz und nah verbinden, sonst neue Spur', () => {
    expect(gapDecision(p(0, 0), p(50, 60_000)).join).toBe(true)
    expect(gapDecision(p(0, 0), p(500, 60_000)).join).toBe(false)
    expect(gapDecision(p(0, 0), p(10, 20 * 60_000)).join).toBe(false)
  })
})

describe('pointsFromTrack', () => {
  it('Geometrie + Zeiten', () => {
    const pts = pointsFromTrack(JSON.stringify({ type: 'LineString', coordinates: [[7.5, 47], [7.6, 47.1]] }), JSON.stringify(['2026-10-12T08:00:00.000Z', '2026-10-12T08:00:01.000Z']))
    expect(pts).toEqual([
      { lat: 47, lng: 7.5, timestamp: Date.parse('2026-10-12T08:00:00.000Z') },
      { lat: 47.1, lng: 7.6, timestamp: Date.parse('2026-10-12T08:00:01.000Z') },
    ])
    expect(pointsFromTrack(null, null)).toEqual([])
  })
})
