// CH1903+/LV95 (EPSG:2056) ↔ WGS84.
//
// Swiss Oblique Mercator mit der 3-Parameter-Datumsverschiebung von
// swisstopo (Näherung, Genauigkeit etwa ±1 m — für Karte, Skizze und Export an
// Planer ausreichend; für amtliche Vermessung gilt das Verfahren REFRAME/
// NTv2 der swisstopo). Kontrollpunkt (Test): 46.786537 / 7.401863 →
// E 2'597'192 / N 1'181'708.

import proj4 from 'proj4'

export const LV95_DEF =
  '+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 ' +
  '+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel ' +
  '+towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs'

export type LngLat = [number, number]

/** WGS84 (Länge, Breite) → LV95 (E, N) in Metern. */
export function wgs84ToLv95([lng, lat]: LngLat): [number, number] {
  return proj4(proj4.WGS84, LV95_DEF, [lng, lat]) as [number, number]
}

/** LV95 (E, N) → WGS84 (Länge, Breite). */
export function lv95ToWgs84([e, n]: [number, number]): LngLat {
  return proj4(LV95_DEF, proj4.WGS84, [e, n]) as LngLat
}

/** Länge einer Linie in Metern, gerechnet in LV95 (Karte in Metern, nicht Grad). */
export function lineLengthM(coords: LngLat[]): number {
  let sum = 0
  let prev: [number, number] | null = null
  for (const c of coords) {
    const p = wgs84ToLv95(c)
    if (prev) sum += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    prev = p
  }
  return sum
}

/** Fläche eines Polygonrings in m² (Gauss, in LV95). */
export function ringAreaM2(ring: LngLat[]): number {
  const pts = ring.map(wgs84ToLv95)
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/** Schweizer Schreibweise: 2'597'192.1 */
export function fmtLv95(v: number, digits = 1): string {
  const [int, dec] = Math.abs(v).toFixed(digits).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  return `${v < 0 ? '-' : ''}${grouped}${dec ? '.' + dec : ''}`
}
