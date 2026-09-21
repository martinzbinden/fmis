export interface LatLng {
  lat: number
  lng: number
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export const DWELL_RADIUS_M = 15
export const DWELL_DURATION_MS = 60_000

/** Prüft, ob die zuletzt aufgezeichneten Punkte auf einen "Stopp" hindeuten
 * (alle innerhalb DWELL_RADIUS_M um den letzten Fix, über mindestens
 * DWELL_DURATION_MS) — Kandidat für einen Unkraut-Fund. Reine Heuristik mit
 * sinnvollen Startwerten, in der Praxis (echte Traktorfahrt) nachzujustieren. */
export function detectDwell(points: (LatLng & { timestamp: number })[]): LatLng | null {
  if (points.length === 0) return null
  const last = points[points.length - 1]
  let windowStartIdx = points.length - 1
  for (let i = points.length - 1; i >= 0; i--) {
    if (last.timestamp - points[i].timestamp > DWELL_DURATION_MS) break
    if (haversineMeters(points[i], last) > DWELL_RADIUS_M) return null
    windowStartIdx = i
  }
  const elapsed = last.timestamp - points[windowStartIdx].timestamp
  if (elapsed >= DWELL_DURATION_MS) return { lat: last.lat, lng: last.lng }
  return null
}
