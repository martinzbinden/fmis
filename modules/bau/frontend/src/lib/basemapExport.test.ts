import { describe, expect, it } from 'vitest'
import { lv95ToWgs84 } from '@fmis/core/lv95'
import { areaResolution, culturesInArea, exportArea, groundOverlaysKml, worldFile } from './basemapExport'

const at = (e: number, n: number) => lv95ToWgs84([e, n])
const line = (a: [number, number], b: [number, number]) => ({ geometry: JSON.stringify({ type: 'LineString', coordinates: [at(...a), at(...b)] }) })

describe('Gebiet der Grundlagen', () => {
  it('ist der Perimeter der Objekte plus Puffer in LV95', () => {
    const a = exportArea([line([2597000, 1181800], [2597200, 1181900])], [], 100)!
    expect(a.e0).toBeGreaterThanOrEqual(2596899)
    expect(a.e0).toBeLessThanOrEqual(2596900)
    expect(a.e1).toBeGreaterThanOrEqual(2597300)
    expect(a.e1).toBeLessThanOrEqual(2597301)
    expect(a.n1 - a.n0).toBeGreaterThanOrEqual(300)
    expect(a.n1 - a.n0).toBeLessThanOrEqual(302)
  })
  it('nimmt Messpunkte mit und ist ohne Geometrie leer', () => {
    expect(exportArea([], [])).toBeNull()
    const [lng, lat] = at(2597000, 1181800)
    const a = exportArea([], [{ lat, lng }], 0)!
    expect(a.e1 - a.e0).toBeLessThanOrEqual(2)
  })
  it('schreibt das Worldfile auf die Pixelmitte oben links', () => {
    expect(worldFile({ e0: 2597000, n0: 1181000, e1: 2597100, n1: 1181100 }, 0.2).split('\n').slice(0, 6)).toEqual(['0.2000', '0', '0', '-0.2000', '2597000.1000', '1181099.9000'])
  })
  it('begrenzt die Bildgrösse auf 4000 Pixel', () => {
    expect(areaResolution({ e0: 0, n0: 0, e1: 400, n1: 300 })).toBe(0.15)
    expect(areaResolution({ e0: 0, n0: 0, e1: 2000, n1: 300 })).toBe(0.5)
  })
  it('legt Bilder im KMZ als GroundOverlay ab', () => {
    const kml = groundOverlaysKml([{ base: 'grundlage_wasser', name: 'LK: Wasser', ext: 'png', data: new Uint8Array(), box: { west: 7.39, south: 46.78, east: 7.41, north: 46.79 } }])
    expect(kml).toContain('<href>files/grundlage_wasser.png</href>')
    expect(kml).toContain('<north>46.79000000</north>')
  })
  it('nimmt nur Kulturflächen im Gebiet', () => {
    const poly = (e: number, n: number) => ({ flurname: 'Matte', kulturName: 'Kunstwiese', geometry: JSON.stringify({ type: 'Polygon', coordinates: [[at(e, n), at(e + 50, n), at(e + 50, n + 50), at(e, n)]] }) })
    const a = { e0: 2597000, n0: 1181800, e1: 2597200, n1: 1181900 }
    expect(culturesInArea([poly(2597100, 1181850), poly(2599000, 1181850)], a).map((c) => c.name)).toEqual(['Matte · Kunstwiese'])
  })
})
