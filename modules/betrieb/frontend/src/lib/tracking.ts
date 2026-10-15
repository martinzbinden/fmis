import { getCurrentUserEmail } from '@fmis/core/auth'
import { upsertRow, softDeleteRow } from '../db/write'
import type { Track } from '../types'

export interface TrackPoint {
  lat: number
  lng: number
  timestamp: number
}

/** Baut aus den bisher aufgezeichneten Punkten die GeoJSON-LineString-Zeichenkette + die
 * parallele Zeitstempel-Liste (für den späteren GPX-Export, siehe lib/gpx.ts). Ein
 * LineString braucht mindestens 2 Punkte — bei weniger bleibt die Geometrie null. */
export function pointsToTrackFields(points: TrackPoint[]): { geometry: string | null; point_times: string } {
  if (points.length < 2) {
    return { geometry: null, point_times: JSON.stringify(points.map((p) => new Date(p.timestamp).toISOString())) }
  }
  const geometry = JSON.stringify({
    type: 'LineString',
    coordinates: points.map((p) => [p.lng, p.lat]),
  })
  const point_times = JSON.stringify(points.map((p) => new Date(p.timestamp).toISOString()))
  return { geometry, point_times }
}

export interface StartTrackDetails {
  label: string | null
  widthM: number | null
  workType: string | null
  machine: string | null
  operator: string | null
  /** Maschine aus der Liste (schema/0015), sonst nur Freitext in `machine`. */
  machineId?: string | null
  /** Traktor aus der Liste (schema/0016). */
  tractorId?: string | null
}

export async function startTrack(seasonYear: number, details: StartTrackDetails): Promise<string> {
  const id = crypto.randomUUID()
  await upsertRow('tracks', {
    id,
    season_year: seasonYear,
    label: details.label,
    started_at: new Date().toISOString(),
    ended_at: null,
    width_m: details.widthM,
    geometry: null,
    point_times: '[]',
    point_count: 0,
    notes: null,
    created_by: getCurrentUserEmail(),
    work_type: details.workType,
    machine: details.machine,
    operator: details.operator,
    machine_id: details.machineId ?? null,
    tractor_id: details.tractorId ?? null,
  } as never)
  return id
}

/** Schreibt den aktuellen Aufzeichnungsstand fort — aufgerufen periodisch während der
 * Aufzeichnung, damit bei einem Tab-Absturz/-Schliessen nichts verloren geht. */
export async function saveTrackProgress(track: Track, points: TrackPoint[]): Promise<void> {
  const { geometry, point_times } = pointsToTrackFields(points)
  await upsertRow('tracks', {
    ...track,
    geometry,
    point_times,
    point_count: points.length,
  } as never)
}

export async function stopTrack(track: Track, points: TrackPoint[]): Promise<void> {
  const { geometry, point_times } = pointsToTrackFields(points)
  await upsertRow('tracks', {
    ...track,
    geometry,
    point_times,
    point_count: points.length,
    ended_at: new Date().toISOString(),
  } as never)
}

export async function deleteTrack(track: Track): Promise<void> {
  await softDeleteRow('tracks', track.id)
}
