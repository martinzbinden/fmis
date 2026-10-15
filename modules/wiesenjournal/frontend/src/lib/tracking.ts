import { getCurrentUserEmail } from '@fmis/core/auth'
import { upsertRow, softDeleteRow } from '../db/write'
import type { WeedObservation, WeedSeverity, WeedSource, WeedType } from '../types'

// Unkraut-Meldungen (Spuren und Tracking: Modul Betrieb).

export interface WeedObservationInput {
  seasonYear: number
  lat: number
  lng: number
  accuracyM: number | null
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
    accuracy_m: input.accuracyM,
    notes: input.notes,
    created_by: getCurrentUserEmail(),
  } as never)
  return id
}

export async function updateWeedObservation(
  observation: WeedObservation,
  changes: Partial<
    Pick<
      WeedObservation,
      'weed_type' | 'severity' | 'treatment' | 'treated_at' | 'notes' | 'parcel_id' | 'geometry' | 'accuracy_m'
    >
  >,
): Promise<void> {
  await upsertRow('weed_observations', { ...observation, ...changes } as never)
}

/** Für "Position neu bestimmen" im Unkraut-Dialog — ein frischer GPS-Fix statt des beim Öffnen erfassten. */
export function getCurrentPositionOnce(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
  })
}

export async function deleteWeedObservation(observation: WeedObservation): Promise<void> {
  await softDeleteRow('weed_observations', observation.id)
}
