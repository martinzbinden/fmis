import { describe, expect, it } from 'vitest'
import { lv95ToWgs84 } from './lv95'
import { areaM2, computeShares, fertilizationOverlay, pointInMulti, prepareParcels, toLv, type LvMulti } from './geo'

const E = 2600000
const N = 1200000
function rect(x: number, y: number, w: number, h: number): LvMulti {
  return [[[[E + x, N + y], [E + x + w, N + y], [E + x + w, N + y + h], [E + x, N + y + h], [E + x, N + y]]]]
}
function asGeoJson(m: LvMulti): string {
  return JSON.stringify({ type: 'Polygon', coordinates: m[0].map((r) => r.map((p) => lv95ToWgs84(p as [number, number]))) })
}

describe('Flächenrechnung LV95', () => {
  it('Fläche und Rückumrechnung', () => {
    const g = toLv(asGeoJson(rect(0, 0, 100, 50)))!
    expect(areaM2(g)).toBeCloseTo(5000, 0)
  })
  it('Punkt in Polygon mit Loch', () => {
    const m: LvMulti = [[rect(0, 0, 100, 100)[0][0], rect(40, 40, 20, 20)[0][0]]]
    expect(pointInMulti(E + 10, N + 10, m)).toBe(true)
    expect(pointInMulti(E + 50, N + 50, m)).toBe(false)
    expect(pointInMulti(E + 150, N + 50, m)).toBe(false)
  })
  it('Anteile einer Teilfläche über zwei Parzellen', () => {
    const parcels = prepareParcels([
      { id: 'a', name: 'A', base_geometry: asGeoJson(rect(0, 0, 100, 100)) },
      { id: 'b', name: 'B', base_geometry: asGeoJson(rect(100, 0, 100, 100)) },
      { id: 'c', name: 'C', base_geometry: asGeoJson(rect(500, 0, 100, 100)) },
    ])
    // Streifen 150 m × 20 m, davon 100 m in A, 50 m in B
    const res = computeShares(rect(0, 0, 150, 20), parcels)
    expect(res.area_a).toBeCloseTo(30, 1)
    expect(res.shares.map((s) => s.parcel_id)).toEqual(['a', 'b'])
    expect(res.shares[0].area_a).toBeCloseTo(20, 1)
    expect(res.shares[1].area_a).toBeCloseTo(10, 1)
    expect(res.unassigned_a).toBeCloseTo(0, 1)
  })
  it('Randanteile unter 0.5 a fallen weg', () => {
    const parcels = prepareParcels([
      { id: 'a', name: 'A', base_geometry: asGeoJson(rect(0, 0, 100, 100)) },
      { id: 'b', name: 'B', base_geometry: asGeoJson(rect(100, 0, 100, 100)) },
    ])
    const res = computeShares(rect(0, 0, 101, 20), parcels) // 20 m² in B
    expect(res.shares).toHaveLength(1)
    expect(res.unassigned_a).toBeCloseTo(0.2, 1)
  })
  it('Düngungskarte: Überlappung summiert', () => {
    const faces = fertilizationOverlay([
      { geom: rect(0, 0, 100, 100), n_kg_per_ha: 30, n_avail_kg_per_ha: 18 },
      { geom: rect(50, 0, 100, 100), n_kg_per_ha: 40, n_avail_kg_per_ha: 24 },
    ])
    const byN = new Map(faces.map((f) => [f.n_kg_per_ha, f]))
    expect([...byN.keys()].sort((a, b) => a - b)).toEqual([30, 40, 70])
    expect(byN.get(70)!.area_a).toBeCloseTo(50, 1)
    expect(byN.get(70)!.count).toBe(2)
    expect(byN.get(30)!.area_a).toBeCloseTo(50, 1)
    expect(byN.get(40)!.area_a).toBeCloseTo(50, 1)
  })
})
