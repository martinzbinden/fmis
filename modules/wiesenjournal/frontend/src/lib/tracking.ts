import { getCurrentUserEmail } from '@fmis/core/auth'
import { upsertRow, softDeleteRow } from '../db/write'
import type { Track, WeedObservation, WeedSeverity, WeedSource, WeedType } from '../types'

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

export async function startTrack(seasonYear: number, label: string | null, widthM: number | null): Promise<string> {
  const id = crypto.randomUUID()
  await upsertRow('tracks', {
    id,
    season_year: seasonYear,
    label,
    started_at: new Date().toISOString(),
    ended_at: null,
    width_m: widthM,
    geometry: null,
    point_times: '[]',
    point_count: 0,
    notes: null,
    created_by: getCurrentUserEmail(),
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

export interface WeedObservationInput {
  seasonYear: number
  lat: number
  lng: number
  weedType: WeedType
  severity: WeedSeverity | null
  treatment: string | null
  treatedAt: string | null
  notes: string | null
  parcelId: string | null
  trackId: string | null
  source: WeedSource
}

export async function createWeedObservation(input: WeedObservationInput): Promise<string> {
  const id = crypto.randomUUID()
  await upsertRow('weed_observations', {
    id,
    season_year: input.seasonYear,
    parcel_id: input.parcelId,
    track_id: input.trackId,
    observed_at: new Date().toISOString(),
    weed_type: input.weedType,
    severity: input.severity,
    treatment: input.treatment,
    treated_at: input.treatedAt,
    source: input.source,
    geometry: JSON.stringify({ type: 'Point', coordinates: [input.lng, input.lat] }),
    notes: input.notes,
    created_by: getCurrentUserEmail(),
  } as never)
  return id
}

export async function updateWeedObservation(
  observation: WeedObservation,
  changes: Partial<Pick<WeedObservation, 'weed_type' | 'severity' | 'treatment' | 'treated_at' | 'notes' | 'parcel_id'>>,
): Promise<void> {
  await upsertRow('weed_observations', { ...observation, ...changes } as never)
}

export async function deleteWeedObservation(observation: WeedObservation): Promise<void> {
  await softDeleteRow('weed_observations', observation.id)
}
