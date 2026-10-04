// Überlappung und Lücken einer Arbeit (GPS-Spuren): Arbeitsabschnitte im
// Client (lib/slurry.ts coverageRuns), Puffern/Verschneiden auf dem Server
// (backend/app/fertilization.py POST /fertilization/coverage).

import { API_URL, getToken } from '@fmis/core/auth'
import { coverageRuns, fieldShape, type FieldShape } from './slurry'
import type { Track } from '../types'

export interface CoverageParcel {
  parcel_id: string
  name: string
  area_m2: number
  covered_m2: number
  overlap_m2: number
  gap_m2: number
  overlap_geojson: string | null
  gap_geojson: string | null
}

/** Punkte einer gespeicherten Spur mit Zeiten (falls vorhanden). */
export function trackPointsWithTimes(t: Track): { lat: number; lng: number; t: number | null }[] {
  if (!t.geometry) return []
  try {
    const coords = (JSON.parse(t.geometry) as { coordinates: [number, number][] }).coordinates
    let times: string[] = []
    try {
      times = JSON.parse(t.point_times ?? '[]') as string[]
    } catch {
      times = []
    }
    return coords.map(([lng, lat], i) => ({ lat, lng, t: times[i] ? Date.parse(times[i]) : null }))
  } catch {
    return []
  }
}

/** Spuren derselben Arbeit: gleicher Tag und gleiches Gerät (bzw. nur diese
 * Spur ohne Gerät). */
export function sameJob(track: Track, all: Track[]): Track[] {
  const day = localDay(track.started_at)
  if (!track.machine_id) return [track]
  return all.filter((t) => t.machine_id === track.machine_id && localDay(t.started_at) === day && !t.deleted_at)
}

/** Kalendertag (Ortszeit) eines Zeitstempels — pglite liefert timestamptz
 * als Date, der Sync als Text. */
export const localDay = (v: string | Date) => new Date(v).toLocaleDateString('sv')
/** Zeitpunkt in ms, egal ob Date oder Text. */
export const timeMs = (v: string | Date) => new Date(v).getTime()

export function fieldShapes(parcels: { id: string; base_geometry: string | null }[]): FieldShape[] {
  return parcels.map((p) => fieldShape(p.id, p.base_geometry)).filter((f): f is FieldShape => f != null)
}

export async function fetchCoverage(tracks: Track[], fields: FieldShape[], widthM: number, seasonYear: number): Promise<CoverageParcel[]> {
  const runs = tracks.flatMap((t) => coverageRuns(trackPointsWithTimes(t), fields))
  if (!runs.length) return []
  const res = await fetch(`${API_URL}/wiesenjournal/fertilization/coverage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
    body: JSON.stringify({ season_year: seasonYear, width_m: widthM, runs }),
  })
  if (!res.ok) throw new Error(`Abdeckung: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { parcels: CoverageParcel[] }).parcels
}
