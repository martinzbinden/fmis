import { describe, expect, it } from 'vitest'
import { alongTrack, crossTrack, currentRunStart, laneOf, lanePoint, lanesCovering, nextFreeLane, refFromAB, refFromField, refFromRecent, shiftRefTo, steer, travelSign, workedLanes, type GuideRef } from './guidance'
import { fieldShape } from './slurry'

const LAT = 47
const LNG = 7.5
const mLat = 111195
const mLng = 111195 * Math.cos((LAT * Math.PI) / 180)
const at = (east: number, north: number) => ({ lat: LAT + north / mLat, lng: LNG + east / mLng })
// Feld 200 m Ost-West × 50 m
const rect = JSON.stringify({ type: 'Polygon', coordinates: [[at(0, 0), at(200, 0), at(200, 50), at(0, 50), at(0, 0)].map((p) => [p.lng, p.lat])] })

describe('guidance', () => {
  // Referenz nach Ost durch (0, 10): rechts = Süden
  const ref: GuideRef = { origin: at(0, 10), headingDeg: 90, source: 'bahn' }

  it('quer zur Referenz: rechts positiv, Bahn und Abweichung', () => {
    expect(crossTrack(ref, at(50, 3))).toBeCloseTo(7, 1)
    expect(crossTrack(ref, at(50, 17))).toBeCloseTo(-7, 1)
    const l = laneOf(ref, at(80, 1.5), 7)
    expect(l.lane).toBe(1)
    expect(l.offsetM).toBeCloseTo(1.5, 1)
  })

  it('Lenkhinweis berücksichtigt die Fahrtrichtung', () => {
    expect(travelSign(ref, 92)).toBe(1)
    expect(travelSign(ref, 268)).toBe(-1)
    expect(travelSign(ref, 0)).toBeNull()
    // 1.5 m rechts der Bahnmitte (südlich), nach Ost fahrend → links lenken
    expect(steer(1.5, 1)).toEqual({ direction: 'links', meters: 1.5 })
    // gleiche Lage, nach West fahrend → rechts lenken
    expect(steer(1.5, -1).direction).toBe('rechts')
    expect(steer(0.2, 1).direction).toBe('gerade')
  })

  it('nächste freie Bahn: erst Lücken, dann daneben', () => {
    expect(nextFreeLane(new Set([0, 1, 3]), 3)).toBe(2)
    expect(nextFreeLane(new Set([0, 1, 2]), 2)).toBe(3)
    expect(nextFreeLane(new Set([0, 1, 2]), 0)).toBe(-1)
    expect(nextFreeLane(new Set(), 4)).toBe(4)
  })

  it('Referenz am Feldrand: Bahn 0 eine halbe Breite innen, entlang der langen Seite', () => {
    const field = fieldShape('p', rect)!
    const r = refFromField(field, at(20, 5), 7)!
    expect(Math.round(r.headingDeg) % 180).toBe(90)
    // Bahn 0 liegt bei Nord 3.5 m (Südrand + 3.5)
    expect(Math.abs(crossTrack(r, at(100, 3.5)))).toBeLessThan(0.2)
    expect(laneOf(r, at(100, 10.5), 7).lane).not.toBe(0)
  })

  it('Referenz aus der gefahrenen Strecke und gefahrene Bahnen', () => {
    const pts = Array.from({ length: 30 }, (_, i) => at(10 + i * 2, 10))
    const r = refFromRecent(pts)!
    expect(r.headingDeg).toBeCloseTo(90, 0)
    const field = fieldShape('p', rect)!
    const lane2 = Array.from({ length: 40 }, (_, i) => at(150 - i * 3, 10 + 14.3)) // Bahn 2 Richtung West
    const worked = workedLanes(r, [...pts, ...lane2], 7, [field])
    expect([...worked].sort()).toEqual([-2, 0])
    // laufende Fahrt auf Bahn −2 zählt nicht als frühere: davor nur Bahn 0
    const all = [...pts, ...lane2]
    const before = workedLanes(r, all.slice(0, currentRunStart(r, all, 7)), 7, [field])
    expect([...before]).toEqual([0])
  })
})

describe('A-B-Linie, Nachziehen, Bahnen', () => {
  const A = { lat: 47, lng: 7.5 }
  const north = (m: number, east = 0) => ({ lat: 47 + m / 111195, lng: 7.5 + east / (111195 * Math.cos((47 * Math.PI) / 180)) })
  it('A-B nach Norden, zu kurz = null', () => {
    const r = refFromAB(A, north(100))!
    expect(r.source).toBe('ab')
    expect(Math.round(r.headingDeg)).toBe(0)
    expect(refFromAB(A, north(10))).toBeNull()
  })
  it('Hier = Bahnmitte: Versatz verschwindet, Bahn bleibt', () => {
    const r = refFromAB(A, north(100))!
    const here = north(50, 6 + 0.8) // Bahn 1 bei 6 m Breite, 0.8 m daneben
    expect(laneOf(r, here, 6).lane).toBe(1)
    const s = shiftRefTo(r, here, 6)
    const p = laneOf(s, here, 6)
    expect(p.lane).toBe(1)
    expect(Math.abs(p.offsetM)).toBeLessThan(0.01)
  })
  it('Bahnen über ein Gebiet und Punkte darauf', () => {
    const r = refFromAB(A, north(100))!
    const area = [north(0, -1), north(100, -1), north(100, 13), north(0, 13)]
    const lanes = lanesCovering(r, area, 6)
    expect(lanes.map((l) => l.lane)).toEqual([0, 1, 2])
    const p = lanePoint(r, 2, 6, 50)
    expect(Math.round(crossTrack(r, p))).toBe(12)
    expect(Math.round(alongTrack(r, p))).toBe(50)
  })
})
