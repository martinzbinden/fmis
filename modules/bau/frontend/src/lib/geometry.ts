// Geometrie der Bauobjekte: GeoJSON (WGS84) als Text, Länge/Fläche in LV95.

import { lineLengthM, ringAreaM2, type LngLat } from '@fmis/core/lv95'

export type Geom =
  | { type: 'Point'; coordinates: LngLat }
  | { type: 'LineString'; coordinates: LngLat[] }
  | { type: 'Polygon'; coordinates: LngLat[][] }

const isPos = (v: unknown): v is LngLat =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && Number.isFinite(v[0]) && Number.isFinite(v[1])

/** Geometrie lesen; ungültige/leere/andere Typen → null. Höhenwerte (3. Stelle) werden verworfen. */
export function parseGeometry(text: string | null | undefined): Geom | null {
  if (!text) return null
  try {
    return normalizeGeometry(JSON.parse(text))
  } catch {
    return null
  }
}

export function normalizeGeometry(g: unknown): Geom | null {
  if (!g || typeof g !== 'object') return null
  const { type, coordinates } = g as { type?: string; coordinates?: unknown }
  if (type === 'Point' && isPos(coordinates)) return { type, coordinates: [coordinates[0], coordinates[1]] }
  if (type === 'LineString' && Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(isPos)) {
    return { type, coordinates: (coordinates as LngLat[]).map((c) => [c[0], c[1]] as LngLat) }
  }
  if (type === 'Polygon' && Array.isArray(coordinates) && coordinates.length >= 1) {
    const rings = (coordinates as unknown[]).map((r) => (Array.isArray(r) && r.length >= 4 && r.every(isPos) ? (r as LngLat[]).map((c) => [c[0], c[1]] as LngLat) : null))
    if (rings.every(Boolean)) return { type, coordinates: rings as LngLat[][] }
  }
  return null
}

export const stringifyGeometry = (g: Geom): string => JSON.stringify(g)

/** Länge in m (Linie; Polygon = Umfang), sonst null. */
export function lengthM(g: Geom | null): number | null {
  if (!g) return null
  if (g.type === 'LineString') return lineLengthM(g.coordinates)
  if (g.type === 'Polygon') return lineLengthM(g.coordinates[0])
  return null
}

export function areaM2(g: Geom | null): number | null {
  return g?.type === 'Polygon' ? ringAreaM2(g.coordinates[0]) : null
}

/** Alle Stützpunkte (für Ausdehnung/Zoom). */
export function allPositions(g: Geom): LngLat[] {
  if (g.type === 'Point') return [g.coordinates]
  if (g.type === 'LineString') return g.coordinates
  return g.coordinates.flat()
}

/** [[südlich, westlich], [nördlich, östlich]] für Leaflet fitBounds. */
export function boundsOf(geoms: (Geom | null)[]): [[number, number], [number, number]] | null {
  const pts = geoms.flatMap((g) => (g ? allPositions(g) : []))
  if (!pts.length) return null
  const lngs = pts.map((p) => p[0])
  const lats = pts.map((p) => p[1])
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ]
}

/** Länge schön: 279.6 m / 1.25 km */
export function fmtLength(m: number | null): string {
  if (m == null) return '–'
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(m < 100 ? 1 : 0)} m`
}

export function fmtArea(m2: number | null): string {
  if (m2 == null) return '–'
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`
}
