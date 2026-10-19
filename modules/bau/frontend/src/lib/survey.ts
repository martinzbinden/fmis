// Einmessen: Genauigkeit einstufen, Punktnummern, Linie aus Messpunkten.

import { normalizeGeometry, type Geom } from './geometry'
import type { SurveyPoint } from '../types'

/** gut ≤ 2 m, brauchbar ≤ 5 m, schlecht darüber (Handy-GPS liegt meist bei 3–5 m). */
export type AccuracyClass = 'gut' | 'ok' | 'schlecht' | 'unbekannt'
export const ACCURACY_WARN_M = 5

export function accuracyClass(m: number | null | undefined): AccuracyClass {
  if (m == null || !Number.isFinite(m)) return 'unbekannt'
  return m <= 2 ? 'gut' : m <= ACCURACY_WARN_M ? 'ok' : 'schlecht'
}

export function nextPointNo(points: Pick<SurveyPoint, 'point_no'>[]): number {
  return points.reduce((m, p) => Math.max(m, p.point_no), 0) + 1
}

export function nextSeq(points: Pick<SurveyPoint, 'feature_id' | 'seq'>[], featureId: string | null): number {
  return points.filter((p) => p.feature_id === featureId).reduce((m, p) => Math.max(m, p.seq), 0) + 1
}

/** Linie (≥ 2 Punkte) aus den Messpunkten eines Objekts in Messreihenfolge. */
export function lineFromPoints(points: Pick<SurveyPoint, 'lat' | 'lng' | 'seq' | 'measured_at'>[]): Geom | null {
  const sorted = [...points].sort((a, b) => a.seq - b.seq || a.measured_at.localeCompare(b.measured_at))
  return normalizeGeometry({ type: 'LineString', coordinates: sorted.map((p) => [p.lng, p.lat]) })
}

/** Einzelner Messpunkt als Punkt-Geometrie (Schacht, Gebäudeecke). */
export function pointFromSurvey(p: Pick<SurveyPoint, 'lat' | 'lng'>): Geom {
  return { type: 'Point', coordinates: [p.lng, p.lat] }
}
