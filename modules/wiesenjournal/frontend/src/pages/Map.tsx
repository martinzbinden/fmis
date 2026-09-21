import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import PaddockMap from '../components/PaddockMap'
import Modal from '../components/Modal'
import WeedForm, { type WeedFormValues } from '../components/WeedForm'
import { createPaddock, saveNewVersion, deletePaddock, loadCurrentPaddocks } from '../lib/paddock'
import {
  startTrack,
  saveTrackProgress,
  stopTrack,
  deleteTrack,
  createWeedObservation,
  updateWeedObservation,
  deleteWeedObservation,
  type TrackPoint,
} from '../lib/tracking'
import { detectDwell } from '../lib/geo'
import { downloadGpx } from '../lib/gpx'
import { fmtDateTime, todayIso } from '../lib/format'
import AckerToggle from '../components/AckerToggle'
import { categoryFilterSql, useShowAcker } from '../hooks/useShowAcker'
import type { Paddock, Parcel, Track, WeedObservation } from '../types'

const CURRENT_YEAR = new Date().getFullYear()

async function loadMapData(pg: PGlite, seasonYear: number, showAcker: boolean) {
  const [paddocks, { rows: parcels }, { rows: tracks }, { rows: weedObservations }] = await Promise.all([
    loadCurrentPaddocks(seasonYear),
    pg.query<Parcel>(
      `select * from parcels where season_year = $1 and deleted_at is null${categoryFilterSql(showAcker)} order by sort_order, name`,
      [seasonYear],
    ),
    pg.query<Track>('select * from tracks where season_year = $1 and deleted_at is null order by started_at desc', [seasonYear]),
    pg.query<WeedObservation>('select * from weed_observations where season_year = $1 and deleted_at is null order by observed_at desc', [
      seasonYear,
    ]),
  ])
  return { paddocks, parcels, tracks, weedObservations }
}

export default function Map() {
  const [searchParams] = useSearchParams()
  const focusParcelId = searchParams.get('parcel')
  const [seasonYear] = useState(CURRENT_YEAR)
  const [showAcker] = useShowAcker()
  const { data, refresh } = useQuery((pg) => loadMapData(pg, seasonYear, showAcker), [seasonYear, showAcker])
  const canTrack = useHasPermission('wiesenjournal:tracking:write')

  const [detailTarget, setDetailTarget] = useState<Paddock | null>(null)
  const [newPaddockId, setNewPaddockId] = useState<string | null>(null)

  const paddocks = data?.paddocks ?? []
  const parcels = data?.parcels ?? []
  const tracks = data?.tracks ?? []
  const weedObservations = data?.weedObservations ?? []

  // --- Tracking (Traktor-Knopf) ---
  const [recording, setRecording] = useState(false)
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [livePoints, setLivePoints] = useState<TrackPoint[]>([])
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null)
  const [dwellCandidate, setDwellCandidate] = useState<{ lat: number; lng: number } | null>(null)
  const currentTrackRef = useRef(currentTrack)
  currentTrackRef.current = currentTrack

  useEffect(() => {
    if (!recording || !currentTrack) return
    if (!('geolocation' in navigator)) {
      alert('GPS ist auf diesem Gerät/Browser nicht verfügbar.')
      setRecording(false)
      return
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const point: TrackPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, timestamp: pos.timestamp }
        setCurrentPosition({ lat: point.lat, lng: point.lng })
        setLivePoints((prev) => {
          const next = [...prev, point]
          if (next.length % 10 === 0 && currentTrackRef.current) {
            void saveTrackProgress(currentTrackRef.current, next)
          }
          const dwell = detectDwell(next)
          setDwellCandidate((prevCandidate) => dwell ?? (prevCandidate && !dwell ? null : prevCandidate))
          return next
        })
      },
      (err) => console.error('GPS-Fehler', err),
      { enableHighAccuracy: true, maximumAge: 2000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [recording, currentTrack])

  async function startRecording() {
    const trackId = await startTrack(seasonYear, null, null)
    refresh()
    setCurrentTrack({
      id: trackId,
      season_year: seasonYear,
      label: null,
      started_at: new Date().toISOString(),
      ended_at: null,
      width_m: null,
      geometry: null,
      point_times: '[]',
      point_count: 0,
      notes: null,
      created_by: null,
      updated_at: new Date().toISOString(),
      deleted_at: null,
    })
    setLivePoints([])
    setDwellCandidate(null)
    setRecording(true)
  }

  async function stopRecording() {
    if (currentTrack) {
      await stopTrack(currentTrack, livePoints)
    }
    setRecording(false)
    setCurrentTrack(null)
    setLivePoints([])
    setDwellCandidate(null)
    refresh()
  }

  async function handleDeleteTrack(track: Track) {
    if (!confirm(`Track "${track.label ?? fmtDateTime(track.started_at)}" löschen?`)) return
    await deleteTrack(track)
    refresh()
  }

  // --- Unkraut-Knopf ---
  const [pickingLocation, setPickingLocation] = useState(false)
  const [weedTarget, setWeedTarget] = useState<{
    lat: number
    lng: number
    source: 'manual' | 'gps_dwell'
    existing?: WeedObservation
  } | null>(null)

  function openWeedButton() {
    if (currentPosition) {
      setWeedTarget({ lat: currentPosition.lat, lng: currentPosition.lng, source: 'manual' })
    } else {
      setPickingLocation(true)
    }
  }

  function handlePickLocation(lat: number, lng: number) {
    setPickingLocation(false)
    setWeedTarget({ lat, lng, source: 'manual' })
  }

  function confirmDwell() {
    if (!dwellCandidate) return
    setWeedTarget({ lat: dwellCandidate.lat, lng: dwellCandidate.lng, source: 'gps_dwell' })
    setDwellCandidate(null)
  }

  function handleWeedSelect(observation: WeedObservation) {
    const geo = JSON.parse(observation.geometry) as { coordinates: [number, number] }
    setWeedTarget({ lat: geo.coordinates[1], lng: geo.coordinates[0], source: 'manual', existing: observation })
  }

  async function saveWeed(values: WeedFormValues) {
    if (!weedTarget) return
    if (weedTarget.existing) {
      await updateWeedObservation(weedTarget.existing, {
        weed_type: values.weedType,
        severity: values.severity,
        treatment: values.treatment.trim() || null,
        treated_at: values.treatedAt || null,
        notes: values.notes.trim() || null,
      })
    } else {
      await createWeedObservation({
        seasonYear,
        lat: weedTarget.lat,
        lng: weedTarget.lng,
        weedType: values.weedType,
        severity: values.severity,
        treatment: values.treatment.trim() || null,
        treatedAt: values.treatedAt || null,
        notes: values.notes.trim() || null,
        parcelId: focusParcelId ?? null,
        trackId: weedTarget.source === 'gps_dwell' ? (currentTrack?.id ?? null) : null,
        source: weedTarget.source,
      })
    }
    setWeedTarget(null)
    refresh()
  }

  async function deleteWeed() {
    if (!weedTarget?.existing) return
    await deleteWeedObservation(weedTarget.existing)
    setWeedTarget(null)
    refresh()
  }

  // --- Weidegänge (unverändert) ---
  async function handleCreated(geometry: string) {
    const paddockId = await createPaddock({
      parcel_id: focusParcelId ?? null,
      season_year: seasonYear,
      valid_from: todayIso(),
      animal_group: null,
      geometry,
      notes: null,
    })
    setNewPaddockId(paddockId)
    refresh()
  }

  async function handleAdopted(geometry: string) {
    const paddockId = await createPaddock({
      parcel_id: focusParcelId ?? null,
      season_year: seasonYear,
      valid_from: todayIso(),
      animal_group: null,
      geometry,
      notes: 'Übernommen aus Kulturen-Vorlage (deckt sich mit der Parzelle)',
    })
    setNewPaddockId(paddockId)
    refresh()
  }

  async function handleEdited(paddockId: string, geometry: string) {
    await saveNewVersion(paddockId, { geometry })
    refresh()
  }

  async function handleDeleted(paddockId: string) {
    await deletePaddock(paddockId)
    refresh()
  }

  function handleSelect(paddockId: string) {
    const p = paddocks.find((pp) => pp.paddock_id === paddockId)
    if (p) setDetailTarget(p)
  }

  const editingTarget = detailTarget ?? (newPaddockId ? paddocks.find((p) => p.paddock_id === newPaddockId) ?? null : null)

  return (
    <div className="space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Karte · Weidegänge {seasonYear}</h1>
        <AckerToggle />
      </div>
      <p className="text-xs text-gray-500">
        Zeichne einen Weidegang direkt auf die Karte (Toolbar oben rechts). Jede Verschiebung des Zauns wird als neue
        Version gespeichert — die Karte zeigt immer den aktuellen Ist-Zustand, die Historie bleibt erhalten.
      </p>

      {canTrack && (
        <div className="flex flex-wrap items-center gap-2">
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              🚜 Tracking starten
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              ⏹ Tracking beenden ({livePoints.length} Punkte)
            </button>
          )}
          <button
            type="button"
            onClick={openWeedButton}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            🌿 Unkraut melden
          </button>
        </div>
      )}

      {dwellCandidate && (
        <div className="flex items-center justify-between rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <span>Hier länger angehalten — Unkraut melden?</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setDwellCandidate(null)} className="rounded px-2 py-1 text-xs">
              Verwerfen
            </button>
            <button type="button" onClick={confirmDwell} className="rounded bg-amber-600 px-2 py-1 text-xs text-white">
              Melden
            </button>
          </div>
        </div>
      )}

      <PaddockMap
        paddocks={paddocks}
        parcels={parcels}
        tracks={tracks}
        livePoints={recording ? livePoints : null}
        weedObservations={weedObservations}
        pickingLocation={pickingLocation}
        onCreated={handleCreated}
        onEdited={handleEdited}
        onDeleted={handleDeleted}
        onSelect={handleSelect}
        onAdoptFieldsGeometry={handleAdopted}
        onLocationFound={(lat, lng) => setCurrentPosition({ lat, lng })}
        onWeedSelect={handleWeedSelect}
        onPickLocation={handlePickLocation}
      />

      {tracks.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-gray-700">Tracks {seasonYear}</h2>
          <ul className="space-y-1">
            {tracks.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-white p-2 text-xs shadow-sm">
                <span>
                  {t.label ?? fmtDateTime(t.started_at)} · {t.point_count} Punkte
                  {!t.ended_at && <span className="ml-1 font-medium text-red-600">(läuft)</span>}
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => downloadGpx(t)} className="text-brand-700">
                    GPX
                  </button>
                  <button type="button" onClick={() => handleDeleteTrack(t)} className="text-red-600">
                    Löschen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editingTarget && (
        <PaddockDetailsModal
          paddock={editingTarget}
          parcels={parcels}
          onClose={() => {
            setDetailTarget(null)
            setNewPaddockId(null)
          }}
          onSaved={refresh}
          onEnded={() => {
            setDetailTarget(null)
            setNewPaddockId(null)
            refresh()
          }}
        />
      )}

      {weedTarget && (
        <WeedForm
          title={weedTarget.existing ? 'Unkraut bearbeiten' : 'Unkraut melden'}
          initial={
            weedTarget.existing
              ? {
                  weedType: weedTarget.existing.weed_type,
                  severity: weedTarget.existing.severity,
                  treatment: weedTarget.existing.treatment ?? '',
                  treatedAt: weedTarget.existing.treated_at ?? '',
                  notes: weedTarget.existing.notes ?? '',
                }
              : undefined
          }
          onClose={() => setWeedTarget(null)}
          onSave={saveWeed}
          onDelete={weedTarget.existing ? deleteWeed : undefined}
        />
      )}
    </div>
  )
}

function PaddockDetailsModal({
  paddock,
  parcels,
  onClose,
  onSaved,
  onEnded,
}: {
  paddock: Paddock
  parcels: Parcel[]
  onClose: () => void
  onSaved: () => void
  onEnded: () => void
}) {
  const [animalGroup, setAnimalGroup] = useState(paddock.animal_group ?? '')
  const [parcelId, setParcelId] = useState(paddock.parcel_id ?? '')
  const [notes, setNotes] = useState(paddock.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await saveNewVersion(paddock.paddock_id, {
        animal_group: animalGroup.trim() || null,
        parcel_id: (parcelId || null) as never,
        notes: notes.trim() || null,
      })
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function end() {
    if (!confirm('Diesen Weidegang beenden? Er verschwindet aus der aktuellen Karte, die Historie bleibt erhalten.')) return
    await deletePaddock(paddock.paddock_id)
    onEnded()
  }

  return (
    <Modal title="Weidegang" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Tiergruppe</span>
          <input
            type="text"
            placeholder="z.B. 12 Milchkühe"
            value={animalGroup}
            onChange={(e) => setAnimalGroup(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            autoFocus
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Parzelle (optional)</span>
          <select
            value={parcelId}
            onChange={(e) => setParcelId(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">– keine Zuordnung –</option>
            {parcels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Bemerkung</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            rows={2}
          />
        </label>
        <div className="flex items-center justify-between border-t pt-3">
          <button type="button" onClick={end} className="rounded-lg px-3 py-1.5 text-sm text-red-600">
            Weidegang beenden
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Schliessen
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
