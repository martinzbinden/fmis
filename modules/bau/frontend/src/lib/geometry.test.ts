import { describe, expect, it } from 'vitest'
import { areaM2, boundsOf, fmtArea, fmtLength, lengthM, normalizeGeometry, parseGeometry } from './geometry'
import { FEATURES } from './testData'

describe('Geometrie', () => {
  it('liest gültige Geometrien und verwirft Ungültiges', () => {
    expect(parseGeometry(FEATURES[0].geometry)?.type).toBe('LineString')
    expect(parseGeometry(null)).toBeNull()
    expect(parseGeometry('kaputt')).toBeNull()
    expect(normalizeGeometry({ type: 'LineString', coordinates: [[1, 2]] })).toBeNull() // < 2 Punkte
    expect(normalizeGeometry({ type: 'Polygon', coordinates: [[[1, 2], [3, 4], [5, 6]]] })).toBeNull() // Ring < 4
    expect(normalizeGeometry({ type: 'MultiPoint', coordinates: [] })).toBeNull()
  })

  it('verwirft die Höhe (3. Wert) der Stützpunkte', () => {
    expect(normalizeGeometry({ type: 'Point', coordinates: [7.4, 46.8, 523] })).toEqual({ type: 'Point', coordinates: [7.4, 46.8] })
  })

  it('Länge in LV95-Metern: 100 m + 50 m', () => {
    expect(lengthM(parseGeometry(FEATURES[0].geometry))).toBeCloseTo(150, 2)
    expect(lengthM(parseGeometry(FEATURES[1].geometry))).toBeNull()
  })

  it('Fläche: 10 × 10 m = 100 m²; Umfang 40 m', () => {
    const g = parseGeometry(FEATURES[2].geometry)
    expect(areaM2(g)).toBeCloseTo(100, 2)
    expect(lengthM(g)).toBeCloseTo(40, 2)
  })

  it('Ausdehnung und Formatierung', () => {
    const b = boundsOf(FEATURES.map((f) => parseGeometry(f.geometry)))!
    expect(b[0][0]).toBeLessThan(b[1][0])
    expect(boundsOf([null])).toBeNull()
    expect(fmtLength(279.64)).toBe('280 m')
    expect(fmtLength(49.96)).toBe('50.0 m')
    expect(fmtLength(1250)).toBe('1.25 km')
    expect(fmtLength(null)).toBe('–')
    expect(fmtArea(100.4)).toBe('100 m²')
    expect(fmtArea(25000)).toBe('2.50 ha')
  })
})
