// GPS-Punkte prüfen und Unterbrüche beurteilen — reine Funktionen (getestet).
// Handy-GPS liefert gelegentlich Ausreisser (Sprung um Dutzende Meter) oder
// sehr ungenaue Punkte (Start, Abschattung): diese kommen nicht in die Spur.

import { haversineMeters } from './geo'
import type { TrackPoint } from './tracking'

/** Schlechter als das: Punkt nicht aufzeichnen (Anzeige bleibt). */
export const MAX_ACCURACY_M = 25
/** Schneller als das zwischen zwei Punkten = Sprung (54 km/h). */
export const MAX_SPEED_MS = 15

export type FixVerdict = { ok: true } | { ok: false; reason: 'ungenau' | 'sprung' | 'doppelt' }

export function acceptFix(last: TrackPoint | null, fix: TrackPoint, accuracyM: number | null): FixVerdict {
  if (accuracyM != null && accuracyM > MAX_ACCURACY_M) return { ok: false, reason: 'ungenau' }
  if (!last) return { ok: true }
  const dt = (fix.timestamp - last.timestamp) / 1000
  if (dt <= 0) return { ok: false, reason: 'doppelt' }
  // nach längerem Unterbruch (Neustart, Abschattung) kein Sprung-Test
  if (dt < 60 && haversineMeters(last, fix) / dt > MAX_SPEED_MS) return { ok: false, reason: 'sprung' }
  return { ok: true }
}

/** Unterbruch beim Fortsetzen: kurz und nah → Spur einfach weiterführen (die
 * Lücke wird gerade verbunden); lang oder weit → neue Spur, damit keine
 * Fläche über Strasse oder Nachbarfeld gezählt wird. */
export function gapDecision(last: TrackPoint, next: TrackPoint, maxGapS = 15 * 60, maxGapM = 300): { join: boolean; gapS: number; gapM: number } {
  const gapS = Math.max(0, (next.timestamp - last.timestamp) / 1000)
  const gapM = haversineMeters(last, next)
  return { join: gapS <= maxGapS && gapM <= maxGapM, gapS, gapM }
}

/** Punkte einer gespeicherten Spur (Geometrie + Zeiten). */
export function pointsFromTrack(geometry: string | null | undefined, pointTimes: string | null | undefined): TrackPoint[] {
  if (!geometry) return []
  try {
    const coords = (JSON.parse(geometry) as { coordinates: [number, number][] }).coordinates
    const times = JSON.parse(pointTimes ?? '[]') as string[]
    return coords.map(([lng, lat], i) => ({ lat, lng, timestamp: times[i] ? Date.parse(times[i]) : 0 }))
  } catch {
    return []
  }
}
