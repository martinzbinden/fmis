import { describe, expect, it } from 'vitest'
import { geoAdminUrl } from './geoAdmin'

// Erfundene Testfläche bei Bern (kein Betriebsbezug)
const square = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[7.43, 46.95], [7.432, 46.95], [7.432, 46.951], [7.43, 46.951], [7.43, 46.95]]],
})

describe('geoAdminUrl', () => {
  it('zentriert in LV95 und schaltet nur Nutzungsflächen und Bewirtschaftungseinheiten ein', () => {
    const url = geoAdminUrl(square)!
    const params = new URLSearchParams(url.split('#/map?')[1])
    const [e, n] = params.get('center')!.split(',').map(Number)
    expect(e).toBeGreaterThan(2598000)
    expect(e).toBeLessThan(2601000)
    expect(n).toBeGreaterThan(1199000)
    expect(n).toBeLessThan(1201000)
    const layers = params.get('layers')!.split(';')
    const visible = layers.filter((l) => !l.endsWith(',f'))
    expect(visible).toEqual([
      'ch.blw.landwirtschaftliche-nutzungsflaechen',
      'WMS|https://geodienste.ch/db/lwb_bewirtschaftungseinheit_v2_0_0/deu|bewirtschaftungseinheit',
    ])
    expect(layers.length).toBeGreaterThan(5)
    expect(params.get('bgLayer')).toBe('ch.swisstopo.swissimage')
  })

  it('ohne Geometrie kein Link', () => {
    expect(geoAdminUrl(null)).toBeNull()
    expect(geoAdminUrl('kaputt')).toBeNull()
  })
})
