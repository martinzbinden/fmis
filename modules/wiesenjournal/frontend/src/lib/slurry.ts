// Güllefass beim GPS-Tracking — reine Funktionen (getestet):
// Feldachse/-länge aus dem Parzellen-Umriss, automatisches "Schieber auf"
// (Fahrt in Feldrichtung), Strecke/Zeit je Fass, Eichung aus "Fass leer",
// Ist-Menge und Soll-Geschwindigkeit, Bahnen je Fass.
//
// Vakuumfass: der Ausfluss Q (m³/min) hängt am Druck, kaum an der
// Fahrgeschwindigkeit — also gilt: Menge/ha = Q ÷ (v × Breite), und ein Fass
// ist nach V ÷ Q Minuten leer, egal wie schnell man fährt.

import { haversineMeters, type LatLng } from './geo'
import { pointInGeometry } from './workPlan'

// --- Geometrie ---

interface XY {
  x: number
  y: number
}

const R_EARTH = 6371000
const toRad = (d: number) => (d * Math.PI) / 180

/** Lokale ebene Koordinaten in Metern (für kleine Flächen genau genug). */
function projector(lat0: number, lng0: number) {
  const k = Math.cos(toRad(lat0))
  return (lat: number, lng: number): XY => ({ x: toRad(lng - lng0) * R_EARTH * k, y: toRad(lat - lat0) * R_EARTH })
}

/** Richtung von a nach b in Grad, 0 = Nord, im Uhrzeigersinn. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const p = projector(a.lat, a.lng)(b.lat, b.lng)
  return (Math.atan2(p.x, p.y) * 180) / Math.PI + (p.x < 0 ? 360 : 0)
}

/** Winkelabstand zweier Richtungen ohne Vorzeichen der Fahrtrichtung (0–90°). */
export function axisDiff(headingDeg: number, axisDeg: number): number {
  const d = (((headingDeg - axisDeg) % 180) + 180) % 180
  return Math.min(d, 180 - d)
}

function outerRing(geometry: string): [number, number][] | null {
  try {
    const g = JSON.parse(geometry) as { type: string; coordinates: unknown }
    if (g.type === 'Polygon') return (g.coordinates as [number, number][][])[0] ?? null
    if (g.type === 'MultiPolygon') {
      // grösster Teil
      const polys = g.coordinates as [number, number][][][]
      return polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0] ?? null
    }
  } catch {
    // ungültig
  }
  return null
}

export interface FieldAxis {
  /** Feldlänge in Fahrrichtung (lange Seite des kleinsten umschliessenden Rechtecks) */
  lengthM: number
  widthM: number
  /** Richtung der langen Seite, 0–180°, 0 = Nord */
  axisDeg: number
}

/** Hauptachse einer Parzelle: kleinstes umschliessendes Rechteck (in 1°-
 * Schritten), dessen lange Seite die übliche Fahrrichtung ist. */
export function fieldAxis(geometry: string | null): FieldAxis | null {
  const ring = geometry ? outerRing(geometry) : null
  if (!ring || ring.length < 3) return null
  const [lng0, lat0] = ring[0]
  const proj = projector(lat0, lng0)
  const pts = ring.map(([lng, lat]) => proj(lat, lng))
  let best: FieldAxis & { area: number } = { lengthM: 0, widthM: 0, axisDeg: 0, area: Infinity }
  for (let deg = 0; deg < 180; deg++) {
    const a = toRad(deg)
    // Achse in Richtung deg (Nord = +y)
    const ux = Math.sin(a)
    const uy = Math.cos(a)
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const p of pts) {
      const u = p.x * ux + p.y * uy
      const v = -p.x * uy + p.y * ux
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const lu = maxU - minU
    const lv = maxV - minV
    const area = lu * lv
    if (area < best.area - 1e-6) {
      best = lu >= lv ? { lengthM: lu, widthM: lv, axisDeg: deg, area } : { lengthM: lv, widthM: lu, axisDeg: (deg + 90) % 180, area }
    }
  }
  return { lengthM: Math.round(best.lengthM), widthM: Math.round(best.widthM), axisDeg: best.axisDeg }
}

// --- Fass während der Fahrt ---

export interface FieldShape {
  id: string
  geometry: string
  axisDeg: number
  bbox: [number, number, number, number] // minLng, minLat, maxLng, maxLat
}

export function fieldShape(id: string, geometry: string | null): FieldShape | null {
  const axis = fieldAxis(geometry)
  const ring = geometry ? outerRing(geometry) : null
  if (!axis || !ring || !geometry) return null
  const lngs = ring.map((c) => c[0])
  const lats = ring.map((c) => c[1])
  return { id, geometry, axisDeg: axis.axisDeg, bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] }
}

export function fieldAt<F extends FieldShape>(fields: F[], p: LatLng): F | null {
  return (
    fields.find((f) => p.lng >= f.bbox[0] && p.lng <= f.bbox[2] && p.lat >= f.bbox[1] && p.lat <= f.bbox[3] && pointInGeometry(p.lng, p.lat, f.geometry)) ?? null
  )
}

/** Fahrt in Feldrichtung: höchstens so viel Grad neben der Feldachse. */
export const ALIGN_DEG = 25
/** Arbeitsgeschwindigkeit 1.4–18 km/h (darunter Stillstand/GPS-Rauschen). */
export const MIN_SPEED_MS = 0.4
export const MAX_SPEED_MS = 5
/** Zeit ausserhalb jeder Parzelle, nach der ein nicht gemeldetes Fass als
 * leer gilt (Fahrt zur Grube). */
export const AUTO_EMPTY_OUTSIDE_S = 120

export interface TankState {
  /** in Feldrichtung gefahrene Strecke dieses Fasses */
  distM: number
  /** Zeit dabei */
  spreadS: number
  /** Strecke je Parzelle (das Fass gehört zur Parzelle mit der grössten) */
  byField: Record<string, number>
  /** letzte Bewegung zählte als Ausbringen */
  spreading: boolean
  outsideSinceMs: number | null
  last: (LatLng & { t: number }) | null
}

export const emptyTank = (): TankState => ({ distM: 0, spreadS: 0, byField: {}, spreading: false, outsideSinceMs: null, last: null })

export const mainField = (s: TankState): string | null => Object.entries(s.byField).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

export interface StepResult {
  state: TankState
  /** Fass gilt als leer, weil der Traktor das Feld länger verlassen hat */
  autoEmpty: TankState | null
}

/** Einen GPS-Punkt verarbeiten. "Schieber auf" = in einer Parzelle, in
 * Feldrichtung, mit Arbeitsgeschwindigkeit; Wenden und Fahrten ausserhalb
 * zählen nicht. */
export function step(state: TankState, p: LatLng & { t: number }, fields: FieldShape[]): StepResult {
  const last = state.last
  if (!last || p.t <= last.t) return { state: { ...state, last: last && p.t <= last.t ? last : p }, autoEmpty: null }
  const dt = (p.t - last.t) / 1000
  const field = fieldAt(fields, p)
  let next: TankState = { ...state, last: p }
  if (dt <= 30) {
    const d = haversineMeters(last, p)
    const v = d / dt
    const aligned = field != null && d > 0.3 && axisDiff(bearingDeg(last, p), field.axisDeg) <= ALIGN_DEG
    const spreading = field != null && aligned && v >= MIN_SPEED_MS && v <= MAX_SPEED_MS
    next = spreading
      ? { ...next, spreading, distM: state.distM + d, spreadS: state.spreadS + dt, byField: { ...state.byField, [field.id]: (state.byField[field.id] ?? 0) + d } }
      : { ...next, spreading: false }
  }
  if (field) return { state: { ...next, outsideSinceMs: null }, autoEmpty: null }
  const since = state.outsideSinceMs ?? p.t
  if (next.distM >= 30 && (p.t - since) / 1000 >= AUTO_EMPTY_OUTSIDE_S) {
    return { state: { ...emptyTank(), last: p, outsideSinceMs: since }, autoEmpty: next }
  }
  return { state: { ...next, outsideSinceMs: since }, autoEmpty: null }
}

/** Geschwindigkeit der letzten `windowS` Sekunden in m/s. */
export function recentSpeed(points: (LatLng & { t: number })[], windowS = 10): number | null {
  if (points.length < 2) return null
  const end = points[points.length - 1]
  let d = 0
  let i = points.length - 1
  while (i > 0 && (end.t - points[i - 1].t) / 1000 <= windowS) {
    d += haversineMeters(points[i - 1], points[i])
    i--
  }
  const dt = (end.t - points[i].t) / 1000
  return dt >= 2 ? d / dt : null
}

// --- Eichung ---

export interface TankRecord {
  source: 'knopf' | 'auto'
  volume_m3: number
  distance_m: number
  spread_s: number
  width_m: number
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Ausfluss und Menge aus den letzten (höchstens 5) mit dem Knopf
 * gemeldeten Fässern; Ausreisser (unter 30 m bzw. 30 s, über 30 min)
 * zählen nicht. Ohne gültige: Startwert. */
export function calibrate(events: TankRecord[], startFlow: number | null): { flowM3Min: number | null; rateM3Ha: number | null; n: number } {
  const ok = events.filter((e) => e.source === 'knopf' && e.distance_m >= 30 && e.spread_s >= 30 && e.spread_s <= 1800 && e.volume_m3 > 0).slice(-5)
  if (!ok.length) return { flowM3Min: startFlow, rateM3Ha: null, n: 0 }
  return {
    flowM3Min: median(ok.map((e) => e.volume_m3 / (e.spread_s / 60))),
    rateM3Ha: median(ok.map((e) => (e.volume_m3 / (e.distance_m * e.width_m)) * 10000)),
    n: ok.length,
  }
}

// --- Menge, Geschwindigkeit, Bahnen ---

/** Ausgebrachte Menge bei Geschwindigkeit v (m/s): m³/ha. */
export const rateAt = (flowM3Min: number, speedMs: number, widthM: number) => (flowM3Min / 60 / (speedMs * widthM)) * 10000
/** Nötige Geschwindigkeit für eine Menge, km/h. */
export const speedFor = (flowM3Min: number, rateM3Ha: number, widthM: number) => ((flowM3Min / 60 / ((rateM3Ha / 10000) * widthM)) * 3.6)
/** Strecke, bis ein Fass bei dieser Menge leer ist, m. */
export const distancePerTank = (tankM3: number, rateM3Ha: number, widthM: number) => tankM3 / ((rateM3Ha / 10000) * widthM)

export interface SpreadOption {
  /** Bahnen (Feldlängen) je Fass */
  lanes: number
  rateM3Ha: number
  speedKmh: number | null
  deviationPct: number
}

export interface SpreadPlan {
  distPerTankM: number
  speedKmh: number | null
  tanks: number | null
  /** ganze Bahnen je Fass, beste zuerst */
  options: SpreadOption[]
}

/** Damit das Fass am Bahnende leer ist: ganze Bahnen je Fass, Menge und
 * Geschwindigkeit dafür. */
export function planSpreading(p: { tankM3: number; widthM: number; flowM3Min: number | null; targetM3Ha: number; fieldLengthM: number | null; areaHa: number | null }): SpreadPlan {
  const dist = distancePerTank(p.tankM3, p.targetM3Ha, p.widthM)
  const speed = p.flowM3Min ? speedFor(p.flowM3Min, p.targetM3Ha, p.widthM) : null
  const options: SpreadOption[] = []
  if (p.fieldLengthM && p.fieldLengthM > 0) {
    const exact = dist / p.fieldLengthM
    const lanes = [...new Set([Math.floor(exact), Math.ceil(exact)].filter((k) => k >= 1))]
    if (!lanes.length) lanes.push(1)
    for (const k of lanes) {
      const rate = distancePerTank(p.tankM3, 1, p.widthM) / (k * p.fieldLengthM)
      options.push({
        lanes: k,
        rateM3Ha: rate,
        speedKmh: p.flowM3Min ? speedFor(p.flowM3Min, rate, p.widthM) : null,
        deviationPct: ((rate - p.targetM3Ha) / p.targetM3Ha) * 100,
      })
    }
    options.sort((a, b) => Math.abs(a.deviationPct) - Math.abs(b.deviationPct))
  }
  return { distPerTankM: dist, speedKmh: speed, tanks: p.areaHa ? (p.areaHa * p.targetM3Ha) / p.tankM3 : null, options }
}
