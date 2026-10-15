// Mähen mit Restgras (z.B. BFF-Rückzugsstreifen): gemähter Anteil einer
// Parzelle aus der GPS-Spur und der Arbeitsbreite — reine Funktionen
// (getestet). Die Parzelle wird in Zellen (Standard 1 m) gerastert; jede
// Fahrt mit Arbeitstempo markiert die Zellen innerhalb der halben
// Arbeitsbreite. Doppelt Gemähtes zählt so nur einmal.

import { haversineMeters, type LatLng } from './geo'
import { bearingDeg, MAX_SPEED_MS, MIN_SPEED_MS } from './slurry'
import { pointInGeometry } from './workPlan'

const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180

export interface MowGrid {
  origin: LatLng
  cellM: number
  cols: number
  rows: number
  /** 1 = Zelle liegt in der Parzelle */
  inside: Uint8Array
  /** 1 = gemäht */
  mown: Uint8Array
  insideCount: number
  mownCount: number
}

function toXY(origin: LatLng, p: LatLng) {
  return { x: rad(p.lng - origin.lng) * R * Math.cos(rad(origin.lat)), y: rad(p.lat - origin.lat) * R }
}

function toLL(origin: LatLng, x: number, y: number): LatLng {
  return { lat: origin.lat + (y / R) * (180 / Math.PI), lng: origin.lng + (x / (R * Math.cos(rad(origin.lat)))) * (180 / Math.PI) }
}

function ringOf(geometry: string): [number, number][] {
  const g = JSON.parse(geometry) as { type: string; coordinates: unknown }
  if (g.type === 'Polygon') return (g.coordinates as [number, number][][])[0]
  return (g.coordinates as [number, number][][][]).flatMap((p) => p[0])
}

/** Raster über die Parzelle (Begrenzungsrechteck), Zellmitten in der
 * Parzelle zählen. */
export function createGrid(geometry: string, cellM = 1): MowGrid | null {
  let ring: [number, number][]
  try {
    ring = ringOf(geometry)
  } catch {
    return null
  }
  if (ring.length < 3) return null
  const lats = ring.map((c) => c[1])
  const lngs = ring.map((c) => c[0])
  const origin = { lat: Math.min(...lats), lng: Math.min(...lngs) }
  const far = toXY(origin, { lat: Math.max(...lats), lng: Math.max(...lngs) })
  const cols = Math.ceil(far.x / cellM) + 1
  const rows = Math.ceil(far.y / cellM) + 1
  if (cols * rows > 2_000_000) return null
  const inside = new Uint8Array(cols * rows)
  let insideCount = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = toLL(origin, (c + 0.5) * cellM, (r + 0.5) * cellM)
      if (pointInGeometry(p.lng, p.lat, geometry)) {
        inside[r * cols + c] = 1
        insideCount++
      }
    }
  }
  return { origin, cellM, cols, rows, inside, mown: new Uint8Array(cols * rows), insideCount, mownCount: 0 }
}

/** Zellen entlang einer Strecke a→b mit Arbeitsbreite als gemäht
 * markieren; gibt die Anzahl neu gemähter Zellen zurück. */
export function markSegment(grid: MowGrid, a: LatLng, b: LatLng, widthM: number): number {
  const pa = toXY(grid.origin, a)
  const pb = toXY(grid.origin, b)
  const half = widthM / 2
  const minX = Math.max(0, Math.floor((Math.min(pa.x, pb.x) - half) / grid.cellM))
  const maxX = Math.min(grid.cols - 1, Math.floor((Math.max(pa.x, pb.x) + half) / grid.cellM))
  const minY = Math.max(0, Math.floor((Math.min(pa.y, pb.y) - half) / grid.cellM))
  const maxY = Math.min(grid.rows - 1, Math.floor((Math.max(pa.y, pb.y) + half) / grid.cellM))
  const dx = pb.x - pa.x
  const dy = pb.y - pa.y
  const len2 = dx * dx + dy * dy
  let added = 0
  for (let r = minY; r <= maxY; r++) {
    for (let c = minX; c <= maxX; c++) {
      const i = r * grid.cols + c
      if (!grid.inside[i] || grid.mown[i]) continue
      const px = (c + 0.5) * grid.cellM
      const py = (r + 0.5) * grid.cellM
      const t = len2 ? Math.max(0, Math.min(1, ((px - pa.x) * dx + (py - pa.y) * dy) / len2)) : 0
      const qx = pa.x + t * dx - px
      const qy = pa.y + t * dy - py
      if (qx * qx + qy * qy <= half * half) {
        grid.mown[i] = 1
        added++
      }
    }
  }
  grid.mownCount += added
  return added
}

/** Höchstens so viel Richtungsänderung zwischen zwei Strecken gilt als
 * Mähen; schärfere Wendebögen (Mähwerk meist angehoben) zählen nicht. */
export const MOW_TURN_DEG = 30

/** Ganze Spur verarbeiten, ab Punkt `from` (für fortlaufende Berechnung).
 * Gibt die neue Richtung der letzten Strecke zurück. */
export function mowPoints(
  grid: MowGrid,
  points: (LatLng & { t: number | null })[],
  widthM: number,
  from = 1,
  prevHeading: number | null = null,
): number | null {
  let heading = prevHeading
  for (let i = Math.max(1, from); i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const d = haversineMeters(a, b)
    if (d < 0.3) continue
    const h = bearingDeg(a, b)
    const dt = a.t != null && b.t != null ? (b.t - a.t) / 1000 : null
    const speedOk = dt == null || (dt > 0 && dt <= 30 && d / dt >= MIN_SPEED_MS && d / dt <= MAX_SPEED_MS)
    const turn = heading == null ? 0 : Math.abs(((h - heading + 540) % 360) - 180)
    heading = h
    if (speedOk && turn <= MOW_TURN_DEG) markSegment(grid, a, b, widthM)
  }
  return heading
}

export const mownPct = (g: MowGrid) => (g.insideCount ? (g.mownCount / g.insideCount) * 100 : 0)

export type MowState = 'ok' | 'bald' | 'grenze'

/** Wie nahe an der Grenze (100 − Restgras %): ab `warnPct` Prozentpunkten
 * davor "bald", ab der Grenze "grenze". */
export function mowState(pct: number, restPct: number, warnPct = 5): MowState {
  const limit = 100 - restPct
  if (pct >= limit) return 'grenze'
  if (pct >= limit - warnPct) return 'bald'
  return 'ok'
}
