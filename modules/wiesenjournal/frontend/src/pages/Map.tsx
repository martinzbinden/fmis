import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useDb } from '@fmis/core/DbContext'
import { useQuery } from '../hooks/useQuery'
import PaddockMap, { type FertilizationFeature } from '../components/PaddockMap'
import Modal from '../components/Modal'
import WeedForm, { type WeedFormValues } from '../components/WeedForm'
import { createPaddock, saveNewVersion, deletePaddock, loadCurrentPaddocks } from '../lib/paddock'
import {
  createWeedObservation,
  updateWeedObservation,
  deleteWeedObservation,
  getCurrentPositionOnce,
} from '../lib/tracking'
// Spuren und laufende Aufzeichnung gehören dem Modul Betrieb — hier nur
// angezeigt (Karte, Unkraut-Halt, Abdeckung). Bedienung: /betrieb/tracking.
import { useTrackingSession } from '@fmis/betrieb/lib/trackingSession'
import { getSyncedDb as getBetriebDb } from '@fmis/betrieb/db/access'
import type { Track } from '@fmis/betrieb/types'
import { detectDwell, haversineMeters } from '../lib/geo'
import type { NearbyObservation } from '../components/MiniLocationMap'
import { fmtDate, isoDate, todayIso } from '../lib/format'
import { fetchCoverage, fieldShapes, localDay, sameJob, timeMs, type CoverageParcel } from '../lib/coverage'
import AckerToggle from '../components/AckerToggle'
import { categoryFilterSql, useShowAcker, useShowSmall } from '../hooks/useShowAcker'
import type { Paddock, Parcel, WeedObservation } from '../types'
import { notifyError } from '@fmis/core/toast'

const CURRENT_YEAR = new Date().getFullYear()

async function loadMapData(pg: PGlite, seasonYear: number, showAcker: boolean, showSmall: boolean) {
  const [paddocks, { rows: parcels }, { rows: tracks }, { rows: weedObservations }, { rows: fertRows }] = await Promise.all([
    loadCurrentPaddocks(seasonYear),
    pg.query<Parcel>(
      `select * from parcels where season_year = $1 and deleted_at is null${categoryFilterSql(showAcker, showSmall)} order by sort_order, name`,
      [seasonYear],
    ),
    getBetriebDb().then((b) => b.query<Track>('select * from tracks where season_year = $1 and deleted_at is null order by started_at desc', [seasonYear])),
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

export default function Map() {
  const [searchParams, setSearchParams] = useSearchParams()
  const db = useDb()
  const focusParcelId = searchParams.get('parcel')
  const [seasonYear] = useState(CURRENT_YEAR)
  const [showAcker] = useShowAcker()
  const [showSmall] = useShowSmall()
  const { data, refresh } = useQuery((pg) => loadMapData(pg, seasonYear, showAcker, showSmall), [seasonYear, showAcker, showSmall])
  const canTrack = useHasPermission('betrieb:tracking:write')
  const canWeed = useHasPermission('wiesenjournal:tracking:write')

  const [detailTarget, setDetailTarget] = useState<Paddock | null>(null)
  const [newPaddockId, setNewPaddockId] = useState<string | null>(null)

  const paddocks = data?.paddocks ?? []
  const parcels = data?.parcels ?? []
  const tracks = data?.tracks ?? []
  const weedObservations = data?.weedObservations ?? []

  // --- Laufende Aufzeichnung (Betrieb) nur anzeigen ---
  const session = useTrackingSession()
  const recording = session.track != null
  const currentTrack = session.track
  const livePoints = session.points
  const [mapPosition, setMapPosition] = useState<{ lat: number; lng: number; accuracyM: number | null } | null>(null)
  const currentPosition = session.fix ? { lat: session.fix.lat, lng: session.fix.lng, accuracyM: session.fix.accuracyM } : mapPosition
  const [dwellCandidate, setDwellCandidate] = useState<{ lat: number; lng: number } | null>(null)
  // Hier länger angehalten (Unkraut melden?)
  useEffect(() => {
    if (!recording) {
      setDwellCandidate(null)
      return
    }
    setDwellCandidate(detectDwell(livePoints))
  }, [recording, livePoints])

  // ?abdeckung=<Spur> (aus dem Tracking): Doppelt/Lücken zeigen; alte Links
  // (?fahrhilfe=1, ?plan=start, ?abschluss=1) führen in den Betrieb.
  useEffect(() => {
    if (searchParams.get('fahrhilfe') === '1') setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])
  const coverageRequested = useRef<string | null>(null)
  useEffect(() => {
    const id = searchParams.get('abdeckung')
    if (!id || coverageRequested.current === id) return
    const t = tracks.find((x) => x.id === id)
    if (!t) return
    coverageRequested.current = id
    setSearchParams({}, { replace: true })
    void showCoverage(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, tracks])

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
      notifyError(e instanceof Error ? e.message : String(e))
    } finally {
      setCoverageBusy(null)
    }
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
      notifyError('Position konnte nicht neu bestimmt werden.')
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

      {(canTrack || canWeed) && (
        <div className="flex flex-wrap items-center gap-2">
          {canTrack && (
            <Link
              to={recording ? '/betrieb/tracking' : '/betrieb/tracking?start=1'}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${recording ? 'bg-brand-700' : 'bg-purple-600'}`}
            >
              {recording ? `🧭 Tracking öffnen (${livePoints.length} Punkte)` : '🚜 Tracking starten'}
            </Link>
          )}
          {canWeed && (
          <button
            type="button"
            onClick={openWeedButton}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            🌿 Unkraut melden
          </button>
          )}
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
        onLocationFound={(lat, lng, accuracyM) => setMapPosition({ lat, lng, accuracyM })}
        onWeedSelect={handleWeedSelect}
        onPickLocation={handlePickLocation}
        focusParcelId={focusParcelId}
      />

      {tracks.length > 0 && (
        <p className="text-xs text-gray-500">
          {tracks.length} {tracks.length === 1 ? 'Spur' : 'Spuren'} {seasonYear} auf der Karte — Liste, GPX und Abdeckung im{' '}
          <Link to="/betrieb/tracking" className="text-brand-700 underline">
            Tracking
          </Link>
          .{coverageBusy && ' Abdeckung wird berechnet…'}
        </p>
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
        <button type="button" onClick={onClose} className="text-gray-500" aria-label="Schliessen">
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
      <p className="text-xs text-gray-500">
        Gezählt wird gerade Fahrt in der Parzelle mit Arbeitstempo; Wendebögen nicht. «Doppelt» = von zwei Durchgängen überfahren (zu viel
        ausgebracht), «Lücke» = in der Parzelle nicht befahren. Streifen unter 2 m Breite gelten als GPS-Ungenauigkeit und werden
        weggelassen (Handy-GPS ±3–5 m — einzelne Flecken mit Vorsicht deuten, ausgelassene oder doppelte Bahnen sind verlässlich).
      </p>
    </div>
  )
}

