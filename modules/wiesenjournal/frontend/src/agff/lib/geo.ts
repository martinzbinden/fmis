// Flächenrechnung im Browser — ersetzt die PostGIS-Abfragen des FMIS-Servers
// (fmis modules/wiesenjournal/backend/app/fertilization.py und reports.py).
// Alles Metrische in LV95 (EPSG:2056, Meter); Ein- und Ausgabe GeoJSON WGS84.
// Polygon-Verschneidung mit polygon-clipping (Martinez-Algorithmus).

import polygonClipping, { type MultiPolygon, type Pair, type Ring } from 'polygon-clipping'
import { lv95ToWgs84, wgs84ToLv95 } from './lv95'

export type LvMulti = MultiPolygon
export type BBox = [number, number, number, number]

interface GeoJsonGeom {
  type: string
  coordinates: unknown
}

/** Anteile unter 0.5 a sind Rand-Artefakte (wie MIN_SHARE_A im FMIS). */
export const MIN_SHARE_A = 0.5

function parseGeom(g: string | GeoJsonGeom | null | undefined): GeoJsonGeom | null {
  if (!g) return null
  if (typeof g !== 'string') return g
  try {
    return JSON.parse(g) as GeoJsonGeom
  } catch {
    return null
  }
}

/** GeoJSON (Polygon/MultiPolygon, WGS84) → MultiPolygon in LV95; sonst null. */
export function toLv(g: string | GeoJsonGeom | null | undefined): LvMulti | null {
  const geom = parseGeom(g)
  if (!geom) return null
  const ring = (r: [number, number][]): Ring => r.map((p) => wgs84ToLv95([p[0], p[1]]) as Pair)
  if (geom.type === 'Polygon') return [(geom.coordinates as [number, number][][]).map(ring)]
  if (geom.type === 'MultiPolygon') return (geom.coordinates as [number, number][][][]).map((poly) => poly.map(ring))
  return null
}

/** MultiPolygon LV95 → GeoJSON-Geometrie WGS84 (auf ~1 cm gerundet). */
export function toWgs(m: LvMulti): { type: 'MultiPolygon'; coordinates: number[][][][] } {
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7
  return {
    type: 'MultiPolygon',
    coordinates: m.map((poly) => poly.map((ring) => ring.map((p) => lv95ToWgs84(p).map(r7)))),
  }
}

function ringArea(ring: Ring): number {
  let a = 0
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % n]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/** Fläche in m² (Aussenringe minus Löcher). */
export function areaM2(m: LvMulti): number {
  let sum = 0
  for (const poly of m) {
    poly.forEach((ring, i) => {
      sum += i === 0 ? ringArea(ring) : -ringArea(ring)
    })
  }
  return Math.max(sum, 0)
}

export function bbox(m: LvMulti): BBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const poly of m)
    for (const [x, y] of poly[0] ?? []) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  return [minX, minY, maxX, maxY]
}

export function bboxOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Punkt (LV95) in MultiPolygon? Löcher werden berücksichtigt. */
export function pointInMulti(x: number, y: number, m: LvMulti): boolean {
  for (const poly of m) {
    if (!poly[0] || !inRing(x, y, poly[0])) continue
    let inHole = false
    for (let i = 1; i < poly.length; i++) if (inRing(x, y, poly[i])) inHole = true
    if (!inHole) return true
  }
  return false
}

export function intersect(a: LvMulti, b: LvMulti): LvMulti {
  return polygonClipping.intersection(a, b)
}
export function unionAll(list: LvMulti[]): LvMulti {
  if (list.length === 0) return []
  if (list.length === 1) return list[0]
  return polygonClipping.union(list[0], ...list.slice(1))
}
export function subtract(a: LvMulti, b: LvMulti): LvMulti {
  return polygonClipping.difference(a, b)
}

/** Parzelle mit vorbereiteter LV95-Geometrie. */
export interface PreparedParcel {
  id: string
  name: string
  geom: LvMulti
  bbox: BBox
}

export function prepareParcels(parcels: { id: string; name: string; base_geometry: string | null }[]): PreparedParcel[] {
  const out: PreparedParcel[] = []
  for (const p of parcels) {
    const geom = toLv(p.base_geometry)
    if (!geom || geom.length === 0) continue
    out.push({ id: p.id, name: p.name, geom, bbox: bbox(geom) })
  }
  return out
}

export interface ShareResult {
  area_a: number
  unassigned_a: number
  shares: { parcel_id: string; parcel_name: string; area_a: number }[]
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** Anteile einer Fläche (Polygon, LV95) an den Parzellen — wie
 * POST /fertilization/resolve-extent im FMIS, grösster Anteil zuerst. */
export function computeShares(extent: LvMulti, parcels: PreparedParcel[], minShareA = MIN_SHARE_A): ShareResult {
  const total = areaM2(extent) / 100
  const box = bbox(extent)
  const shares: ShareResult['shares'] = []
  for (const p of parcels) {
    if (!bboxOverlap(box, p.bbox)) continue
    const a = areaM2(intersect(extent, p.geom)) / 100
    if (a >= minShareA) shares.push({ parcel_id: p.id, parcel_name: p.name, area_a: round2(a) })
  }
  shares.sort((x, y) => y.area_a - x.area_a)
  const assigned = shares.reduce((s, x) => s + x.area_a, 0)
  return { area_a: round2(total), unassigned_a: round2(Math.max(total - assigned, 0)), shares }
}

export interface OverlayInput {
  geom: LvMulti
  n_kg_per_ha: number
  n_avail_kg_per_ha: number
}

export interface OverlayFace {
  geom: LvMulti
  n_kg_per_ha: number
  n_avail_kg_per_ha: number
  count: number
  area_a: number
}

/** Düngungskarte: planarer Verschnitt aller Massnahmen, je Teilfläche die
 * Summe kg N/ha (ersetzt ST_Node/ST_Polygonize in reports.py). Rechnet
 * schrittweise: jede neue Fläche teilt die bisherigen Teilflächen in «drin»
 * und «draussen», der Rest der neuen Fläche kommt als eigene Teilfläche dazu.
 * Teilflächen unter `minM2` fallen weg. */
export function fertilizationOverlay(inputs: OverlayInput[], minM2 = 5): OverlayFace[] {
  type F = { geom: LvMulti; n: number; na: number; count: number; box: BBox }
  let faces: F[] = []
  let covered: LvMulti = []
  for (const inp of inputs) {
    if (!inp.geom.length) continue
    const box = bbox(inp.geom)
    const next: F[] = []
    for (const f of faces) {
      if (!bboxOverlap(box, f.box)) {
        next.push(f)
        continue
      }
      const inside = intersect(f.geom, inp.geom)
      if (areaM2(inside) < minM2) {
        next.push(f)
        continue
      }
      const outside = subtract(f.geom, inp.geom)
      next.push({ geom: inside, n: f.n + inp.n_kg_per_ha, na: f.na + inp.n_avail_kg_per_ha, count: f.count + 1, box: bbox(inside) })
      if (areaM2(outside) >= minM2) next.push({ ...f, geom: outside, box: bbox(outside) })
    }
    const rest = covered.length ? subtract(inp.geom, covered) : inp.geom
    if (areaM2(rest) >= minM2) next.push({ geom: rest, n: inp.n_kg_per_ha, na: inp.n_avail_kg_per_ha, count: 1, box: bbox(rest) })
    covered = covered.length ? unionAll([covered, inp.geom]) : inp.geom
    faces = next
  }
  return faces
    .map((f) => ({
      geom: f.geom,
      n_kg_per_ha: round2(f.n),
      n_avail_kg_per_ha: round2(f.na),
      count: f.count,
      area_a: round2(areaM2(f.geom) / 100),
    }))
    .filter((f) => f.area_a * 100 >= minM2)
}

/** Mittelpunkt (grob: Mitte der Bounding-Box) einer GeoJSON-Geometrie, [lat, lng]. */
export function centerLatLng(g: string | null): [number, number] | null {
  const m = toLv(g)
  if (!m || !m.length) return null
  const [a, b, c, d] = bbox(m)
  const [lng, lat] = lv95ToWgs84([(a + c) / 2, (b + d) / 2])
  return [lat, lng]
}
