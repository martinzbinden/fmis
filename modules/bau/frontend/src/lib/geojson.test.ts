import { describe, expect, it } from 'vitest'
import { buildGeoJson, parseGeoJson, statusOf } from './geojson'
import { FEATURES, POINTS } from './testData'

describe('GeoJSON', () => {
  it('liest FeatureCollection, Feature und blosse Geometrie', () => {
    const fc = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'A', category: 'strom' }, geometry: { type: 'Point', coordinates: [7.4, 46.8] } }] })
    expect(parseGeoJson(fc)).toMatchObject([{ label: 'A', category: 'strom', geometry: { type: 'Point' } }])
    expect(parseGeoJson(JSON.stringify({ type: 'Feature', properties: { label: 'B' }, geometry: { type: 'LineString', coordinates: [[7, 46], [7.1, 46.1]] } }))).toHaveLength(1)
    expect(parseGeoJson(JSON.stringify({ type: 'Point', coordinates: [7, 46] }))).toHaveLength(1)
  })

  it('zerlegt MultiLineString/MultiPoint; ignoriert Ungültiges', () => {
    const m = JSON.stringify({ type: 'Feature', properties: { name: 'M' }, geometry: { type: 'MultiLineString', coordinates: [[[7, 46], [7.1, 46.1]], [[7.2, 46.2], [7.3, 46.3]]] } })
    expect(parseGeoJson(m).map((f) => f.label)).toEqual(['M (1)', 'M (2)'])
    expect(parseGeoJson('kaputt')).toEqual([])
    expect(parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null }] }))).toEqual([])
  })

  it('Kategorie aus Eigenschaft, sonst aus dem Namen erraten', () => {
    const fc = JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'Wasserleitung' }, geometry: { type: 'Point', coordinates: [7, 46] } },
      { type: 'Feature', properties: { name: 'X', category: 'unbekannt' }, geometry: { type: 'Point', coordinates: [7, 46] } },
    ] })
    expect(parseGeoJson(fc).map((f) => f.category)).toEqual(['wasser', 'sonstiges'])
  })

  it('schreibt alle Attribute, Länge und Messpunkte', () => {
    const fc = JSON.parse(buildGeoJson('P', FEATURES, POINTS))
    expect(fc.features).toHaveLength(4 + 2)
    expect(fc.features[0].properties).toMatchObject({ feature: 'objekt', category: 'guelle', status: 'geplant', material: 'PE 100 ND16', diameter_mm: 90, depth_cm: 120, length_m: 150 })
    expect(fc.features[4].properties).toMatchObject({ feature: 'messpunkt', point_no: 1, accuracy_m: 1.4, altitude_m: 523.46 })
  })

  it('statusOf fällt auf «geplant» zurück', () => {
    expect(statusOf('eingemessen')).toBe('eingemessen')
    expect(statusOf('quatsch')).toBe('geplant')
  })
})
