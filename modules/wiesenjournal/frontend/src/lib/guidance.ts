// Fahrhilfe: Parallelfahren mit Arbeitsbreite — reine Funktionen (getestet).
//
// Eine Referenzlinie (Punkt + Richtung) legt die Bahnmitten fest: Bahn k
// liegt k × Arbeitsbreite quer zur Linie. Referenz ist entweder der
// Feldrand (lange Seite der Parzelle, erste Bahn eine halbe Breite innen)
// oder eine gefahrene Bahn. Handy-GPS ist auf ±3–5 m genau, kurzfristig
// aber stabiler — für ausgelassene/doppelte Bahnen reicht das.

import { haversineMeters, type LatLng } from './geo'
import { bearingDeg, fieldAxis, fieldAt, type FieldShape } from './slurry'

const R = 6371000
const rad = (d: number) => (d * Math.PI) / 180

export interface GuideRef {
  origin: LatLng
  /** Fahrrichtung der Referenz, 0 = Nord */
  headingDeg: number
  source: 'feldrand' | 'bahn'
  /** bei Feldrand: aus welcher Parzelle */
  fieldId?: string
}

/** Lokale Meter relativ zum Ursprung: x = Ost, y = Nord. */
function local(origin: LatLng, p: LatLng) {
  return { x: rad(p.lng - origin.lng) * R * Math.cos(rad(origin.lat)), y: rad(p.lat - origin.lat) * R }
}

function fromLocal(origin: LatLng, x: number, y: number): LatLng {
  return { lat: origin.lat + (y / R) * (180 / Math.PI), lng: origin.lng + (x / (R * Math.cos(rad(origin.lat)))) * (180 / Math.PI) }
}

/** Abstand quer zur Referenz in m: rechts (in Referenzrichtung) positiv. */
export function crossTrack(ref: GuideRef, p: LatLng): number {
  const { x, y } = local(ref.origin, p)
  const h = rad(ref.headingDeg)
  // Einheitsvektor rechts von der Fahrrichtung: (cos h, -sin h)
  return x * Math.cos(h) - y * Math.sin(h)
}

/** Strecke entlang der Referenz in m. */
export function alongTrack(ref: GuideRef, p: LatLng): number {
  const { x, y } = local(ref.origin, p)
  const h = rad(ref.headingDeg)
  return x * Math.sin(h) + y * Math.cos(h)
}

export interface LanePos {
  /** nächste Bahn (0 = Referenz, positiv nach rechts) */
  lane: number
  /** Abweichung von deren Mitte, rechts positiv (in Referenzrichtung) */
  offsetM: number
}

export function laneOf(ref: GuideRef, p: LatLng, widthM: number): LanePos {
  const c = crossTrack(ref, p)
  const lane = Math.round(c / widthM)
  return { lane, offsetM: c - lane * widthM }
}

/** Fährt man gleich oder gegen die Referenz (null = quer, z.B. Wenden). */
export function travelSign(ref: GuideRef, headingDeg: number, toleranceDeg = 35): 1 | -1 | null {
  const d = Math.abs((((headingDeg - ref.headingDeg) % 360) + 540) % 360 - 180)
  if (d <= toleranceDeg) return 1
  if (d >= 180 - toleranceDeg) return -1
  return null
}

export interface Steer {
  /** in welche Richtung lenken, aus Sicht des Fahrers */
  direction: 'links' | 'rechts' | 'gerade'
  meters: number
}

/** Lenkhinweis: Abweichung rechts der Bahnmitte (in Referenzrichtung) → nach
 * links lenken; in Gegenrichtung umgekehrt. Bis `deadbandM` = gerade. */
export function steer(offsetM: number, sign: 1 | -1, deadbandM = 0.3): Steer {
  const m = Math.abs(offsetM)
  if (m <= deadbandM) return { direction: 'gerade', meters: m }
  const rightOfLane = offsetM * sign > 0
  return { direction: rightOfLane ? 'links' : 'rechts', meters: m }
}

/** Nächste freie Bahn neben den gefahrenen: in Fahrrichtung gesehen auf der
 * Seite, auf der noch nichts gefahren ist (sonst die nähere Lücke). */
export function nextFreeLane(worked: Set<number>, current: number): number {
  if (!worked.size) return current
  const min = Math.min(...worked)
  const max = Math.max(...worked)
  // Lücke zwischen gefahrenen Bahnen zuerst
  for (let k = min; k <= max; k++) if (!worked.has(k)) return k
  return Math.abs(current - (max + 1)) <= Math.abs(current - (min - 1)) ? max + 1 : min - 1
}

/** Referenz aus einer gefahrenen Strecke (erster bis letzter Punkt der
 * letzten `meters`). */
export function refFromRecent(points: LatLng[], meters = 30): GuideRef | null {
  if (points.length < 2) return null
  const end = points[points.length - 1]
  for (let i = points.length - 2; i >= 0; i--) {
    const d = local(points[i], end)
    if (Math.hypot(d.x, d.y) >= meters) return { origin: end, headingDeg: bearingDeg(points[i], end), source: 'bahn' }
  }
  return null
}

/** Referenz am Feldrand: lange Seite der Parzelle, Bahn 0 eine halbe
 * Arbeitsbreite innen, an der Seite, die dem Traktor näher liegt. */
export function refFromField(field: FieldShape, near: LatLng, widthM: number): GuideRef | null {
  const axis = fieldAxis(field.geometry)
  if (!axis) return null
  let ring: [number, number][] = []
  try {
    const g = JSON.parse(field.geometry) as { type: string; coordinates: unknown }
    ring = g.type === 'Polygon' ? (g.coordinates as [number, number][][])[0] : (g.coordinates as [number, number][][][])[0][0]
  } catch {
    return null
  }
  const base: GuideRef = { origin: near, headingDeg: axis.axisDeg, source: 'feldrand', fieldId: field.id }
  const cs = ring.map(([lng, lat]) => crossTrack(base, { lat, lng }))
  const minC = Math.min(...cs)
  const maxC = Math.max(...cs)
  // Rand näher am Traktor (c = 0), Bahn 0 eine halbe Breite innen
  const c0 = Math.abs(minC) <= Math.abs(maxC) ? minC + widthM / 2 : maxC - widthM / 2
  const h = rad(axis.axisDeg)
  const { x, y } = { x: c0 * Math.cos(h), y: -c0 * Math.sin(h) }
  return { origin: fromLocal(near, x, y), headingDeg: axis.axisDeg, source: 'feldrand', fieldId: field.id }
}

/** Gefahrene Bahnen: je Bahn die in Fahrrichtung gefahrene Strecke; ab
 * `minM` gilt sie als gefahren. */
export function workedLanes(ref: GuideRef, points: LatLng[], widthM: number, fields: FieldShape[], minM = 20): Set<number> {
  const dist = new Map<number, number>()
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!fieldAt(fields, b)) continue
    const sign = travelSign(ref, bearingDeg(a, b), 20)
    if (sign == null) continue
    const along = Math.abs(alongTrack(ref, b) - alongTrack(ref, a))
    const { lane, offsetM } = laneOf(ref, b, widthM)
    if (Math.abs(offsetM) > widthM / 2) continue
    dist.set(lane, (dist.get(lane) ?? 0) + along)
  }
  return new Set([...dist].filter(([, d]) => d >= minM).map(([k]) => k))
}

/** Beginn der laufenden Fahrt auf der aktuellen Bahn (Index in `points`):
 * rückwärts, solange Bahn und Fahrtrichtung gleich bleiben. Was davor liegt,
 * sind frühere Durchgänge. */
export function currentRunStart(ref: GuideRef, points: LatLng[], widthM: number): number {
  if (points.length < 2) return points.length
  const lane = laneOf(ref, points[points.length - 1], widthM).lane
  let dir: 1 | -1 | null = null
  let i = points.length - 1
  while (i > 0) {
    const a = points[i - 1]
    const b = points[i]
    if (laneOf(ref, a, widthM).lane !== lane) break
    if (haversineMeters(a, b) > 0.3) {
      const s = travelSign(ref, bearingDeg(a, b), 35)
      if (s == null || (dir != null && s !== dir)) break
      dir = s
    }
    i--
  }
  return i
}
