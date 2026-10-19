import { describe, expect, it } from 'vitest'
import { fmtLv95, lineLengthM, lv95ToWgs84, ringAreaM2, wgs84ToLv95 } from './lv95'

describe('LV95', () => {
  it('Kontrollpunkt Burri: 46.786537 / 7.401863 → ca. E 2597192 / N 1181708', () => {
    const [e, n] = wgs84ToLv95([7.401863, 46.786537])
    expect(e).toBeCloseTo(2597192.1, 0)
    expect(n).toBeCloseTo(1181708.3, 0)
  })

  it('Bern (Nullpunkt E 2600000 / N 1200000) liegt in WGS84 bei 46.95108° / 7.43863°', () => {
    // Referenzwert der swisstopo-Näherungsformeln (WGS84)
    const [lng, lat] = lv95ToWgs84([2600000, 1200000])
    expect(lng).toBeCloseTo(7.43863, 4)
    expect(lat).toBeCloseTo(46.95108, 4)
  })

  it('Hin- und Rückumrechnung stimmen auf Millimeter überein', () => {
    const [lng, lat] = lv95ToWgs84(wgs84ToLv95([7.4, 46.79]))
    expect(lng).toBeCloseTo(7.4, 7) // 1e-7° ≈ 1 cm
    expect(lat).toBeCloseTo(46.79, 7)
  })

  it('Länge in Metern: 100 m Nord-Süd', () => {
    const [lng, lat] = lv95ToWgs84([2597000, 1182000])
    const [lng2, lat2] = lv95ToWgs84([2597000, 1182100])
    expect(lineLengthM([[lng, lat], [lng2, lat2]])).toBeCloseTo(100, 3)
    expect(lineLengthM([[lng, lat]])).toBe(0)
  })

  it('Fläche: 10 m × 20 m = 200 m²', () => {
    const c = [[2597000, 1182000], [2597010, 1182000], [2597010, 1182020], [2597000, 1182020]].map((p) => lv95ToWgs84(p as [number, number]))
    expect(ringAreaM2(c)).toBeCloseTo(200, 2)
  })

  it('Schweizer Zahlenschreibweise', () => {
    expect(fmtLv95(2597192.14)).toBe("2'597'192.1")
    expect(fmtLv95(1181708.26, 2)).toBe("1'181'708.26")
  })
})
