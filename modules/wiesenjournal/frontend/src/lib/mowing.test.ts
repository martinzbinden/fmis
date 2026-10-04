import { describe, expect, it } from 'vitest'
import { createGrid, markSegment, mowPoints, mownPct, mowState } from './mowing'

const LAT = 47
const LNG = 7.5
const mLat = 111195
const mLng = 111195 * Math.cos((LAT * Math.PI) / 180)
const at = (east: number, north: number) => ({ lat: LAT + north / mLat, lng: LNG + east / mLng })
// 100 m × 31 m = 3100 m² — genau 10 Bahnen à 3.1 m
const rect = JSON.stringify({ type: 'Polygon', coordinates: [[at(0, 0), at(100, 0), at(100, 31), at(0, 31), at(0, 0)].map((p) => [p.lng, p.lat])] })

describe('mowing', () => {
  it('Raster: Fläche der Parzelle in 1-m-Zellen', () => {
    const g = createGrid(rect)!
    expect(g.insideCount).toBeGreaterThan(3000)
    expect(g.insideCount).toBeLessThan(3200)
  })

  it('eine Bahn à 3.1 m ≈ 10 %, doppelt gemäht zählt einmal', () => {
    const g = createGrid(rect)!
    markSegment(g, at(0, 1.55), at(100, 1.55), 3.1)
    expect(mownPct(g)).toBeGreaterThan(8.5)
    expect(mownPct(g)).toBeLessThan(11.5)
    const before = g.mownCount
    markSegment(g, at(0, 1.55), at(100, 1.55), 3.1)
    expect(g.mownCount).toBe(before)
  })

  it('Spur mit 9 von 10 Bahnen ≈ 90 %, Wendebögen zählen nicht', () => {
    const g = createGrid(rect)!
    const pts: { lat: number; lng: number; t: number }[] = []
    let t = 0
    for (let lane = 0; lane < 9; lane++) {
      const n = 1.55 + lane * 3.1
      const xs = Array.from({ length: 51 }, (_, i) => i * 2)
      for (const x of lane % 2 ? xs.reverse() : xs) pts.push({ ...at(x, n), t: (t += 1000) })
    }
    mowPoints(g, pts, 3.1)
    expect(mownPct(g)).toBeGreaterThan(87)
    expect(mownPct(g)).toBeLessThan(92)
    expect(mowState(mownPct(g), 10)).not.toBe('ok')
  })

  it('Warnstufen bei 10 % Restgras: ab 85 % bald, ab 90 % Grenze', () => {
    expect(mowState(80, 10)).toBe('ok')
    expect(mowState(86, 10)).toBe('bald')
    expect(mowState(90, 10)).toBe('grenze')
    expect(mowState(99, 0)).toBe('bald')
  })
})
