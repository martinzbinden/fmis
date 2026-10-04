import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { useDb } from '@fmis/core/DbContext'
import { useQuery } from '../hooks/useQuery'
import PaddockMap, { type FertilizationFeature } from '../components/PaddockMap'
import Modal from '../components/Modal'
import WeedForm, { type WeedFormValues } from '../components/WeedForm'
import StartTrackDialog from '../components/StartTrackDialog'
import { createPaddock, saveNewVersion, deletePaddock, loadCurrentPaddocks } from '../lib/paddock'
import {
  startTrack,
  saveTrackProgress,
  stopTrack,
  deleteTrack,
  createWeedObservation,
  updateWeedObservation,
  deleteWeedObservation,
  getCurrentPositionOnce,
  type TrackPoint,
  type StartTrackDetails,
} from '../lib/tracking'
import { detectDwell, haversineMeters } from '../lib/geo'
import type { NearbyObservation } from '../components/MiniLocationMap'
import { downloadGpx } from '../lib/gpx'
import { completePlan, getActivePlan, setActivePlan, visitedParcels, type ActivePlan } from '../lib/workPlan'
import { fmtDate, fmtDateTime, isoDate, todayIso } from '../lib/format'
import SlurryPanel from '../components/SlurryPanel'
import DriveAssist from '../components/DriveAssist'
import { loadTrackTanks } from '../lib/slurryData'
import { fetchCoverage, fieldShapes, localDay, sameJob, timeMs, type CoverageParcel } from '../lib/coverage'
import AckerToggle from '../components/AckerToggle'
import { categoryFilterSql, useShowAcker, useShowSmall } from '../hooks/useShowAcker'
import type { Paddock, Parcel, Track, WeedObservation } from '../types'

const CURRENT_YEAR = new Date().getFullYear()

async function loadMapData(pg: PGlite, seasonYear: number, showAcker: boolean, showSmall: boolean) {
  const [paddocks, { rows: parcels }, { rows: tracks }, { rows: weedObservations }, { rows: fertRows }] = await Promise.all([
    loadCurrentPaddocks(seasonYear),
    pg.query<Parcel>(
      `select * from parcels where season_year = $1 and deleted_at is null${categoryFilterSql(showAcker, showSmall)} order by sort_order, name`,
      [seasonYear],
    ),
    pg.query<Track>('select * from tracks where season_year = $1 and deleted_at is null order by started_at desc', [seasonYear]),
    pg.query<WeedObservation>('select * from weed_observations where season_year = $1 and deleted_at is null order by observed_at desc', [
      seasonYear,
    ]),
    // Massnahmen der Saison mit Fläche: eigene Geometrie (Polygon/Track), sonst
    // die gedüngten Parzellen über die Anteile.
    pg.query<{ id: string; entry_date: string; duengung_code: string; amount: unknown; unit: string; n_kg: unknown; geometry: string | null; parcel_geoms: string[] | null }>(
      `select e.id, e.entry_date, e.duengung_code, e.amount, e.unit, e.n_kg, e.geometry,
              (select array_agg(p.base_geometry) from fertilization_shares s join parcels p on p.id = s.parcel_id
                where s.entry_id = e.id and s.deleted_at is null and p.base_geometry is not null) as parcel_geoms
       from fertilization_entries e
       where e.deleted_at is null and extract(year from e.entry_date) = $1`,
      [seasonYear],
    ),
  ])
  const fertilization: FertilizationFeature[] = []
  for (const r of fertRows) {
    const label = `${fmtDate(isoDate(r.entry_date))} · ${r.duengung_code}${r.amount != null ? ` ${r.amount} ${r.unit === 'm3' ? 'm³' : r.unit}` : ''}${
      r.n_kg != null ? ` · ${r.n_kg} kg N` : ''
    }`
    if (r.geometry) fertilization.push({ id: r.id, label, geometry: r.geometry })
    else for (const g of r.parcel_geoms ?? []) fertilization.push({ id: r.id, label, geometry: g })
  }
  return { paddocks, parcels, tracks, weedObservations, fertilization }
}

/** Bildschirm während der Aufzeichnung wach halten: Browser liefern GPS nur,
 * solange die Seite sichtbar ist — bei ausgeschaltetem Bildschirm oder im
 * Hintergrund stoppt watchPosition. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const request = async () => {
      try {
        const l = await navigator.wakeLock.request('screen')
        if (cancelled) void l.release()
        else lock = l
      } catch {
        // z.B. Energiesparmodus — dann eben ohne
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    void request()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [active])
}

/** Punkte eines gespeicherten Tracks (GeoJSON LineString). */
function trackPoints(t: Track): { lat: number; lng: number }[] {
  if (!t.geometry) return []
  try {
    const g = JSON.parse(t.geometry) as { coordinates: [number, number][] }
    return g.coordinates.map(([lng, lat]) => ({ lat, lng }))
  } catch {
    return []
  }
}

export default function Map() {
  const [searchParams, setSearchParams] = useSearchParams()
  const db = useDb()
  const focusParcelId = searchParams.get('parcel')
  const [seasonYear] = useState(CURRENT_YEAR)
  const [showAcker] = useShowAcker()
  const [showSmall] = useShowSmall()
  const { data, refresh } = useQuery((pg) => loadMapData(pg, seasonYear, showAcker, showSmall), [seasonYear, showAcker, showSmall])
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
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number; accuracyM: number | null } | null>(
    null,
  )
  const [startingTrack, setStartingTrack] = useState(false)
  // Vollbild-Fahrhilfe (components/DriveAssist.tsx)
  const [showAssist, setShowAssist] = useState(false)
  const [dwellCandidate, setDwellCandidate] = useState<{ lat: number; lng: number } | null>(null)
  // Zwischenspeichern nicht stapeln: läuft noch eines, wird übersprungen
  // (langsames Gerät oder viele Punkte — sonst wartet «Stop» dahinter)
  const savingRef = useRef(false)
  const currentTrackRef = useRef(currentTrack)
  currentTrackRef.current = currentTrack
  useWakeLock(recording)

  // --- Arbeitsplan-Ausführung (pages/WorkPlan.tsx) ---
  const [activePlan, setActivePlanState] = useState<ActivePlan | null>(() => getActivePlan())
  const [completing, setCompleting] = useState(false)
  const updateActivePlan = (plan: ActivePlan | null) => {
    setActivePlan(plan)
    setActivePlanState(plan)
  }
  // Befahrene Parzellen: alle Spuren seit Planstart plus laufende Aufzeichnung.
  const visited = useMemo(() => {
    if (!activePlan) return new Set<string>()
    const earlier = tracks.filter((t) => timeMs(t.started_at) >= timeMs(activePlan.started_at)).flatMap(trackPoints)
    return visitedParcels(activePlan.task.items, [...earlier, ...(recording ? livePoints : [])])
  }, [activePlan, tracks, livePoints, recording])

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
        setCurrentPosition({ lat: point.lat, lng: point.lng, accuracyM: pos.coords.accuracy })
        setLivePoints((prev) => {
          const next = [...prev, point]
          if (next.length % 10 === 0 && currentTrackRef.current && !savingRef.current) {
            savingRef.current = true
            void saveTrackProgress(currentTrackRef.current, next).finally(() => {
              savingRef.current = false
            })
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

  async function startRecording(details: StartTrackDetails): Promise<string> {
    setStartingTrack(false)
    const trackId = await startTrack(seasonYear, details)
    refresh()
    setCurrentTrack({
      id: trackId,
      season_year: seasonYear,
      label: details.label,
      started_at: new Date().toISOString(),
      ended_at: null,
      width_m: details.widthM,
      geometry: null,
      point_times: '[]',
      point_count: 0,
      notes: null,
      created_by: null,
      updated_at: new Date().toISOString(),
      deleted_at: null,
      work_type: details.workType,
      machine: details.machine,
      operator: details.operator,
      machine_id: details.machineId ?? null,
      tractor_id: details.tractorId ?? null,
    })
    setLivePoints([])
    setDwellCandidate(null)
    setRecording(true)
    // Mit Arbeitsbreite gleich in die Fahrhilfe (Parallelfahren)
    if (details.widthM) setShowAssist(true)
    return trackId
  }

  async function startPlanRecording(plan: ActivePlan) {
    const trackId = await startRecording({
      label: `${plan.task.title} ${fmtDate(plan.task.date)}`,
      widthM: plan.width_m,
      workType: plan.task.work_type,
      machine: [plan.machine_name, plan.tractor_name].filter(Boolean).join(' + ') || null,
      operator: getCurrentUserEmail(),
      machineId: plan.machine_id,
      tractorId: plan.tractor_id ?? null,
    })
    updateActivePlan({ ...plan, track_id: trackId })
  }

  // Vom Arbeitsplan hierher: Aufzeichnung sofort starten.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (searchParams.get('plan') !== 'start' || autoStarted.current || !canTrack) return
    autoStarted.current = true
    setSearchParams({}, { replace: true })
    const plan = getActivePlan()
    if (plan && !recording) void startPlanRecording(plan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canTrack])

  // Von der Übersicht («Fahrhilfe»): Startdialog gleich öffnen
  useEffect(() => {
    if (searchParams.get('fahrhilfe') !== '1' || !canTrack) return
    setSearchParams({}, { replace: true })
    if (recording) setShowAssist(true)
    else setStartingTrack(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canTrack])

  async function stopRecording() {
    // Sofort beenden (GPS aus), dann speichern — schlägt das Speichern fehl,
    // ist die Aufzeichnung trotzdem beendet und der Fehler sichtbar
    const track = currentTrack
    const points = livePoints
    setShowAssist(false)
    setRecording(false)
    setCurrentTrack(null)
    setLivePoints([])
    setDwellCandidate(null)
    if (track) {
      try {
        await stopTrack(track, points)
      } catch (e) {
        alert(`Spur konnte nicht gespeichert werden: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    refresh()
    if (activePlan) setCompleting(true)
  }

  // Gezählte Fässer der Plan-Ausführung je Parzelle (components/SlurryPanel.tsx)
  const planTrackIds = useMemo(
    () => (activePlan ? tracks.filter((t) => timeMs(t.started_at) >= timeMs(activePlan.started_at)).map((t) => t.id) : []),
    [activePlan, tracks],
  )
  const { data: planTanks } = useQuery((pg) => loadTrackTanks(pg, planTrackIds), [planTrackIds.join(','), completing])
  const tanksByParcel = useMemo(() => {
    const m = new globalThis.Map<string, { m3: number; count: number }>()
    for (const t of planTanks ?? []) {
      if (!t.parcel_id) continue
      const e = m.get(t.parcel_id) ?? { m3: 0, count: 0 }
      e.m3 = Math.round((e.m3 + t.volume_m3) * 10) / 10
      e.count++
      m.set(t.parcel_id, e)
    }
    return m
  }, [planTanks])

  async function finishPlan(done: Set<string>, useTanks: boolean) {
    if (!activePlan) return
    await completePlan(db, activePlan, done, todayIso(), useTanks ? tanksByParcel : undefined)
    updateActivePlan(null)
    setCompleting(false)
    refresh()
  }

  // --- Abdeckung: Überlappung und Lücken einer Arbeit (lib/coverage.ts) ---
  const [coverage, setCoverage] = useState<{ title: string; widthM: number; tracks: number; parcels: CoverageParcel[] } | null>(null)
  const [coverageBusy, setCoverageBusy] = useState<string | null>(null)
  async function showCoverage(track: Track) {
    const width = track.width_m
    if (!width) return
    setCoverageBusy(track.id)
    try {
      const job = sameJob(track, tracks)
      const { rows } = await db.query<{ id: string; base_geometry: string | null }>(
        'select id, base_geometry from parcels where season_year = $1 and deleted_at is null and base_geometry is not null',
        [seasonYear],
      )
      const parcelsResult = await fetchCoverage(job, fieldShapes(rows), width, seasonYear)
      setCoverage({ title: `${track.work_type ?? 'Arbeit'} ${fmtDate(localDay(track.started_at))}${track.machine ? ` · ${track.machine}` : ''}`, widthM: width, tracks: job.length, parcels: parcelsResult })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setCoverageBusy(null)
    }
  }

  async function handleDeleteTrack(track: Track) {
    if (!confirm(`Track "${track.label ?? fmtDateTime(track.started_at)}" löschen?`)) return
    await deleteTrack(track)
    refresh()
  }

  // --- Unkraut-Knopf ---
  const [pickingLocation, setPickingLocation] = useState(false)
  const [relocating, setRelocating] = useState(false)
  const [weedTarget, setWeedTarget] = useState<{
    lat: number
    lng: number
    accuracyM: number | null
    source: 'manual' | 'gps_dwell'
    existing?: WeedObservation
  } | null>(null)

  function openWeedButton() {
    if (currentPosition) {
      setWeedTarget({ lat: currentPosition.lat, lng: currentPosition.lng, accuracyM: currentPosition.accuracyM, source: 'manual' })
    } else {
      setPickingLocation(true)
    }
  }

  function handlePickLocation(lat: number, lng: number) {
    setPickingLocation(false)
    setWeedTarget({ lat, lng, accuracyM: null, source: 'manual' })
  }

  function confirmDwell() {
    if (!dwellCandidate) return
    setWeedTarget({ lat: dwellCandidate.lat, lng: dwellCandidate.lng, accuracyM: null, source: 'gps_dwell' })
    setDwellCandidate(null)
  }

  function handleWeedSelect(observation: WeedObservation) {
    const geo = JSON.parse(observation.geometry) as { coordinates: [number, number] }
    setWeedTarget({
      lat: geo.coordinates[1],
      lng: geo.coordinates[0],
      accuracyM: observation.accuracy_m,
      source: 'manual',
      existing: observation,
    })
  }

  function adjustWeedPosition(lat: number, lng: number) {
    setWeedTarget((t) => (t ? { ...t, lat, lng } : t))
  }

  async function relocateWeed() {
    setRelocating(true)
    try {
      const pos = await getCurrentPositionOnce()
      setWeedTarget((t) =>
        t ? { ...t, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy } : t,
      )
    } catch (err) {
      console.error('GPS-Fehler', err)
      alert('Position konnte nicht neu bestimmt werden.')
    } finally {
      setRelocating(false)
    }
  }

  // Bisherige Meldungen dieser Saison in der Nähe des aktuellen Punkts (Kartenvorschau + Liste im Dialog).
  const nearbyWeeds: NearbyObservation[] = (() => {
    if (!weedTarget) return []
    const here = { lat: weedTarget.lat, lng: weedTarget.lng }
    return weedObservations
      .filter((o) => o.id !== weedTarget.existing?.id)
      .map((o) => {
        const geo = JSON.parse(o.geometry) as { coordinates: [number, number] }
        const lat = geo.coordinates[1]
        const lng = geo.coordinates[0]
        return {
          id: o.id,
          lat,
          lng,
          weedType: o.weed_type,
          severity: o.severity,
          observedAt: o.observed_at,
          distanceM: haversineMeters(here, { lat, lng }),
        }
      })
      .filter((o) => o.distanceM <= 150)
      .sort((a, b) => a.distanceM - b.distanceM)
  })()

  async function saveWeed(values: WeedFormValues) {
    if (!weedTarget) return
    if (weedTarget.existing) {
      await updateWeedObservation(weedTarget.existing, {
        weed_type: values.weedType,
        severity: values.severity,
        treatment: values.treatment.trim() || null,
        treated_at: values.treatedAt || null,
        notes: values.notes.trim() || null,
        geometry: JSON.stringify({ type: 'Point', coordinates: [weedTarget.lng, weedTarget.lat] }),
        accuracy_m: weedTarget.accuracyM,
      })
    } else {
      await createWeedObservation({
        seasonYear,
        lat: weedTarget.lat,
        lng: weedTarget.lng,
        accuracyM: weedTarget.accuracyM,
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
              onClick={() => setStartingTrack(true)}
              className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              🚜 Tracking starten
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setShowAssist(true)} className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-medium text-white">
                🧭 Fahrhilfe
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Aufzeichnung beenden?')) void stopRecording()
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
              >
                ⏹ Tracking beenden ({livePoints.length} Punkte)
              </button>
            </>
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

      {activePlan && (
        <div className={`space-y-2 rounded-lg p-3 text-sm ${recording ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">
              {recording ? '● Arbeitsplan läuft' : 'Arbeitsplan unterbrochen'}: {activePlan.task.title} · {fmtDate(activePlan.task.date)}
              {activePlan.machine_name ? ` · ${activePlan.machine_name}` : ''}
              {activePlan.tractor_name ? ` + ${activePlan.tractor_name}` : ''}
            </span>
            <span className="text-xs">
              {visited.size} / {activePlan.task.items.length} Parzellen befahren
            </span>
          </div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-3">
            {activePlan.task.items.map((it) => (
              <li key={it.parcel_id} className={visited.has(it.parcel_id) ? 'font-semibold' : 'opacity-70'}>
                {visited.has(it.parcel_id) ? '✓' : '○'} {it.parcel_name}
                {it.amount != null && it.unit ? ` · ${it.amount} ${it.unit === 'm3' ? 'm³' : it.unit}` : ''}
              </li>
            ))}
          </ul>
          {recording ? (
            <p className="text-xs">
              Bildschirm bleibt eingeschaltet. App im Vordergrund lassen — im Hintergrund oder bei ausgeschaltetem Bildschirm
              zeichnet der Browser kein GPS auf. Ladekabel anschliessen.
            </p>
          ) : (
            canTrack && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void startPlanRecording(activePlan)} className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white">
                  ▶ Aufzeichnung fortsetzen
                </button>
                <button type="button" onClick={() => setCompleting(true)} className="rounded border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium">
                  Ausführung abschliessen
                </button>
              </div>
            )
          )}
        </div>
      )}

      {recording && currentTrack?.machine_id && !showAssist && (
        <SlurryPanel track={currentTrack} points={livePoints} seasonYear={seasonYear} plan={activePlan} accuracyM={currentPosition?.accuracyM ?? null} />
      )}
      {recording && currentTrack && showAssist && (
        <DriveAssist
          track={currentTrack}
          points={livePoints}
          accuracyM={currentPosition?.accuracyM ?? null}
          seasonYear={seasonYear}
          plan={activePlan}
          onClose={() => setShowAssist(false)}
          onStop={() => void stopRecording()}
        />
      )}

      {completing && activePlan && (
        <CompletePlanModal
          plan={activePlan}
          visited={visited}
          onClose={() => setCompleting(false)}
          onCancelPlan={() => {
            updateActivePlan(null)
            setCompleting(false)
          }}
          tanks={tanksByParcel}
          onDone={finishPlan}
        />
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

      {coverage && <CoveragePanel coverage={coverage} onClose={() => setCoverage(null)} />}

      <PaddockMap
        coverage={coverage?.parcels ?? null}
        paddocks={paddocks}
        parcels={parcels}
        fertilization={data?.fertilization ?? []}
        seasonYear={seasonYear}
        tracks={tracks}
        livePoints={recording ? livePoints : null}
        weedObservations={weedObservations}
        pickingLocation={pickingLocation}
        onCreated={handleCreated}
        onEdited={handleEdited}
        onDeleted={handleDeleted}
        onSelect={handleSelect}
        onAdoptFieldsGeometry={handleAdopted}
        onLocationFound={(lat, lng, accuracyM) => setCurrentPosition({ lat, lng, accuracyM })}
        onWeedSelect={handleWeedSelect}
        onPickLocation={handlePickLocation}
        focusParcelId={focusParcelId}
      />

      {tracks.length > 0 && (
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-gray-700">Tracks {seasonYear}</h2>
          <ul className="space-y-1">
            {tracks.map((t) => (
              <li key={t.id} className="flex items-center justify-between rounded-lg bg-white p-2 text-xs shadow-sm">
                <span>
                  {t.label ?? fmtDateTime(t.started_at)}
                  {t.work_type && <span className="text-gray-500"> · {t.work_type}</span>}
                  {t.machine && <span className="text-gray-500"> · {t.machine}</span>}
                  {' · '}
                  {t.point_count} Punkte
                  {!t.ended_at && <span className="ml-1 font-medium text-red-600">(läuft)</span>}
                </span>
                <div className="flex gap-2">
                  {t.width_m != null && t.ended_at && (
                    <button type="button" disabled={coverageBusy != null} onClick={() => void showCoverage(t)} className="text-brand-700 disabled:opacity-50">
                      {coverageBusy === t.id ? 'rechnet…' : 'Abdeckung'}
                    </button>
                  )}
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
          lat={weedTarget.lat}
          lng={weedTarget.lng}
          accuracyM={weedTarget.accuracyM}
          relocating={relocating}
          onRelocate={relocateWeed}
          nearby={nearbyWeeds}
          onAdjustPosition={adjustWeedPosition}
          onClose={() => setWeedTarget(null)}
          onSave={saveWeed}
          onDelete={weedTarget.existing ? deleteWeed : undefined}
        />
      )}
      {startingTrack && (
        <StartTrackDialog onClose={() => setStartingTrack(false)} onStart={startRecording} />
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

function CompletePlanModal({
  plan,
  visited,
  tanks,
  onClose,
  onCancelPlan,
  onDone,
}: {
  plan: ActivePlan
  visited: Set<string>
  tanks: globalThis.Map<string, { m3: number; count: number }>
  onClose: () => void
  onCancelPlan: () => void
  onDone: (done: Set<string>, useTanks: boolean) => Promise<void>
}) {
  const [done, setDone] = useState<Set<string>>(() => new Set(visited))
  const [useTanks, setUseTanks] = useState(true)
  const [saving, setSaving] = useState(false)
  const toggle = (id: string) =>
    setDone((d) => {
      const next = new Set(d)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <Modal title="Ausführung abschliessen" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Erledigte Parzellen werden als ausgeführt ins Journal übernommen (Datum heute). Nicht angekreuzte bleiben geplant.
          Vorausgewählt ist, was laut GPS befahren wurde.
        </p>
        <ul className="divide-y">
          {plan.task.items.map((it) => (
            <li key={it.parcel_id}>
              <label className="flex items-center gap-2 py-1.5">
                <input type="checkbox" checked={done.has(it.parcel_id)} onChange={() => toggle(it.parcel_id)} />
                <span className="flex-1">{it.parcel_name}</span>
                {it.amount != null && it.unit && (
                  <span className="text-gray-600">
                    {it.amount} {it.unit === 'm3' ? 'm³' : it.unit}
                  </span>
                )}
                {visited.has(it.parcel_id) && <span className="text-xs text-green-700">befahren</span>}
              </label>
              {tanks.get(it.parcel_id) && (
                <div className="pb-1 pl-6 text-xs text-amber-800">
                  gezählt: {tanks.get(it.parcel_id)!.count} {tanks.get(it.parcel_id)!.count === 1 ? 'Fass' : 'Fässer'} = {tanks.get(it.parcel_id)!.m3} m³
                </div>
              )}
            </li>
          ))}
        </ul>
        {tanks.size > 0 && (
          <label className="flex items-start gap-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
            <input type="checkbox" className="mt-0.5" checked={useTanks} onChange={(e) => setUseTanks(e.target.checked)} />
            Menge aus den gezählten Fässern übernehmen (statt der geplanten), Nährstoffe neu berechnen
          </label>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onDone(done, useTanks)
            } finally {
              setSaving(false)
            }
          }}
          className="w-full rounded-lg bg-green-600 py-2 font-semibold text-white disabled:opacity-50"
        >
          {done.size} {done.size === 1 ? 'Parzelle' : 'Parzellen'} als ausgeführt übernehmen
        </button>
        <div className="flex justify-between text-xs">
          <button type="button" onClick={onClose} className="text-gray-600 underline">
            Später
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Plan-Ausführung abbrechen? Die Einträge bleiben geplant, die GPS-Spur bleibt gespeichert.')) onCancelPlan()
            }}
            className="text-red-700 underline"
          >
            Ausführung abbrechen
          </button>
        </div>
      </div>
    </Modal>
  )
}

const m2 = (v: number) => (v >= 10000 ? `${(v / 10000).toLocaleString('de-CH', { maximumFractionDigits: 2 })} ha` : `${Math.round(v).toLocaleString('de-CH')} m²`)

/** Ergebnis der Abdeckung: je Parzelle befahren, Überlappung (zu viel) und
 * Lücken (zu wenig); die Karte zeigt sie rot bzw. gelb. */
function CoveragePanel({
  coverage,
  onClose,
}: {
  coverage: { title: string; widthM: number; tracks: number; parcels: CoverageParcel[] }
  onClose: () => void
}) {
  const sum = (k: 'area_m2' | 'covered_m2' | 'overlap_m2' | 'gap_m2') => coverage.parcels.reduce((s, p) => s + p[k], 0)
  return (
    <div className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-gray-800">Abdeckung: {coverage.title}</div>
          <div className="text-xs text-gray-500">
            {coverage.tracks} {coverage.tracks === 1 ? 'Spur' : 'Spuren'} · Arbeitsbreite {Number(coverage.widthM)} m ·{' '}
            <span className="font-medium text-red-700">rot = doppelt</span> · <span className="font-medium text-yellow-700">gelb = Lücke</span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-gray-400" aria-label="Schliessen">
          ×
        </button>
      </div>
      {coverage.parcels.length === 0 ? (
        <p className="text-xs text-gray-500">Keine Arbeitsabschnitte in Parzellen gefunden (Spur ohne Zeiten/zu kurz oder ausserhalb).</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 font-medium">Parzelle</th>
              <th className="py-1 text-right font-medium">befahren</th>
              <th className="py-1 text-right font-medium">doppelt</th>
              <th className="py-1 text-right font-medium">Lücken</th>
            </tr>
          </thead>
          <tbody>
            {coverage.parcels.map((p) => (
              <tr key={p.parcel_id} className="border-t">
                <td className="py-1">{p.name}</td>
                <td className="py-1 text-right">{Math.round((p.covered_m2 / p.area_m2) * 100)} %</td>
                <td className="py-1 text-right text-red-700">
                  {p.overlap_m2 > 0 ? `${m2(p.overlap_m2)} (${Math.round((p.overlap_m2 / Math.max(1, p.covered_m2)) * 100)} %)` : '–'}
                </td>
                <td className="py-1 text-right text-yellow-700">{p.gap_m2 > 0 ? `${m2(p.gap_m2)} (${Math.round((p.gap_m2 / p.area_m2) * 100)} %)` : '–'}</td>
              </tr>
            ))}
            {coverage.parcels.length > 1 && (
              <tr className="border-t font-semibold">
                <td className="py-1">Total</td>
                <td className="py-1 text-right">{Math.round((sum('covered_m2') / sum('area_m2')) * 100)} %</td>
                <td className="py-1 text-right text-red-700">{m2(sum('overlap_m2'))}</td>
                <td className="py-1 text-right text-yellow-700">{m2(sum('gap_m2'))}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-gray-500">
        Gezählt wird gerade Fahrt in der Parzelle mit Arbeitstempo; Wendebögen nicht. «Doppelt» = von zwei Durchgängen überfahren (zu viel
        ausgebracht), «Lücke» = in der Parzelle nicht befahren. Streifen unter 2 m Breite gelten als GPS-Ungenauigkeit und werden
        weggelassen (Handy-GPS ±3–5 m — einzelne Flecken mit Vorsicht deuten, ausgelassene oder doppelte Bahnen sind verlässlich).
      </p>
    </div>
  )
}

