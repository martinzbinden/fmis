import { useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { loadFertilizerTypes } from '../lib/fertilization'
import { num } from '../lib/format'
import { loadMachines } from '../lib/machines'
import { computeNutrients } from '../lib/nutrients'
import {
  calibrate,
  emptyTank,
  fieldAt,
  fieldAxis,
  fieldShape,
  mainField,
  planSpreading,
  rateAt,
  recentSpeed,
  speedFor,
  step,
  type FieldShape,
  type TankState,
} from '../lib/slurry'
import { loadTankEvents, loadTrackTanks, saveTankEvent } from '../lib/slurryData'
import type { ActivePlan } from '../lib/workPlan'
import type { Track } from '../types'
import type { TrackPoint } from '../lib/tracking'

/** Standard-Wunschmenge, wenn kein Plan eine vorgibt. */
export const DEFAULT_RATE_M3_HA = 25

/** Geräte mit Behälter, deren Menge/ha vom Tempo abhängt. */
const LOAD_KINDS = ['guellefass', 'duengerstreuer', 'miststreuer']
const LOAD_LABEL: Record<'m3' | 't' | 'kg', { item: string; empty: string; unit: string; icon: string; defaultRate: number }> = {
  m3: { item: 'Fass', empty: 'Fass leer', unit: 'm³', icon: '🛢', defaultRate: DEFAULT_RATE_M3_HA },
  kg: { item: 'Streuer', empty: 'Streuer leer', unit: 'kg', icon: '🧂', defaultRate: 1000 },
  t: { item: 'Fuder', empty: 'Fuder leer', unit: 't', icon: '🚛', defaultRate: 25 },
}

async function load(pg: PGlite, track: Track, seasonYear: number, plan: ActivePlan | null) {
  const [machines, types, parcels, tankEvents, trackTanks, planEntries] = await Promise.all([
    loadMachines(pg, false),
    loadFertilizerTypes(pg),
    pg.query<{ id: string; name: string; area_a: unknown; base_geometry: string | null }>(
      'select id, name, area_a, base_geometry from parcels where season_year = $1 and deleted_at is null and base_geometry is not null',
      [seasonYear],
    ),
    track.machine_id ? loadTankEvents(pg, track.machine_id) : Promise.resolve([]),
    loadTrackTanks(pg, [track.id]),
    plan
      ? pg.query<{ id: string; fertilizer_type_id: string | null; dilution_factor: unknown }>(
          'select id, fertilizer_type_id, dilution_factor from fertilization_entries where id = any($1)',
          [plan.task.items.flatMap((i) => i.fertilization_ids)],
        )
      : Promise.resolve({ rows: [] }),
  ])
  return { machines, types, parcels: parcels.rows, tankEvents, trackTanks, planEntries: planEntries.rows }
}

const STATE_KEY = (trackId: string) => `wiesenjournal_tank_${trackId}`
const kmh = (ms: number) => ms * 3.6
const fmt1 = (v: number) => v.toLocaleString('de-CH', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
const fmt0 = (v: number) => Math.round(v).toLocaleString('de-CH')
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Güllefass während des Trackings: Tempo und Soll-Tempo, Ist-Menge,
 * Fass-Zähler mit Rest bis leer, "Fass leer"-Knopf (eicht den Ausfluss).
 * "Schieber auf" automatisch, sobald in einer Parzelle in Feldrichtung
 * gefahren wird (lib/slurry.ts). */
export default function SlurryPanel({
  track,
  points,
  seasonYear,
  plan,
  accuracyM,
}: {
  track: Track
  points: TrackPoint[]
  seasonYear: number
  plan: ActivePlan | null
  accuracyM: number | null
}) {
  const { data, refresh } = useQuery((pg) => load(pg, track, seasonYear, plan), [track.id, seasonYear, plan?.started_at])
  const machine = data?.machines.find((m) => m.id === track.machine_id) ?? null
  const width = track.width_m ?? machine?.width_m ?? 7
  // Behälter: Güllefass m³, Dünger-/Kalkstreuer kg, Miststreuer t
  const unit = machine?.capacity_unit ?? 'm3'
  const tankM3 = machine?.capacity ?? (unit === 'm3' ? 6.5 : 0)
  const L = LOAD_LABEL[unit]
  const calib = useMemo(() => calibrate(data?.tankEvents ?? [], machine?.flow_m3_min ?? null), [data, machine])
  const flow = calib.flowM3Min

  const fields = useMemo<(FieldShape & { name: string; areaA: number | null; lengthM: number | null })[]>(
    () =>
      (data?.parcels ?? [])
        .map((p) => {
          const shape = fieldShape(p.id, p.base_geometry)
          return shape ? { ...shape, name: p.name, areaA: num(p.area_a), lengthM: fieldAxis(p.base_geometry)?.lengthM ?? null } : null
        })
        .filter((f): f is NonNullable<typeof f> => f != null),
    [data],
  )

  // Fass-Zustand: aus den Live-Punkten fortgeschrieben, pro Spur gemerkt
  // (übersteht ein Neuladen der Seite)
  const [tank, setTank] = useState<TankState>(() => {
    try {
      return { ...emptyTank(), ...(JSON.parse(localStorage.getItem(STATE_KEY(track.id)) ?? '{}') as Partial<TankState>) }
    } catch {
      return emptyTank()
    }
  })
  // Bereits verarbeitete Punkte mitmerken — sonst zählte ein neu aufgebautes
  // Panel (Karte ↔ Fahrhilfe) die Strecke doppelt
  const processed = useRef<number>(
    (() => {
      try {
        return Number(localStorage.getItem(`${STATE_KEY(track.id)}_n`) ?? 0) || 0
      } catch {
        return 0
      }
    })(),
  )
  const [message, setMessage] = useState<string | null>(null)
  const [targetOverride, setTargetOverride] = useState<number | null>(null)

  async function recordTank(state: TankState, source: 'knopf' | 'auto', at: { lat: number; lng: number } | null) {
    await saveTankEvent({
      id: crypto.randomUUID(),
      track_id: track.id,
      machine_id: track.machine_id ?? null,
      parcel_id: mainField(state) ?? (at ? (fieldAt(fields, at)?.id ?? null) : null),
      event_at: new Date().toISOString(),
      source,
      volume_m3: tankM3,
      unit,
      distance_m: Math.round(state.distM * 10) / 10,
      spread_s: Math.round(state.spreadS * 10) / 10,
      width_m: width,
      lat: at?.lat ?? null,
      lng: at?.lng ?? null,
      notes: null,
      updated_at: '',
      deleted_at: null,
    })
    refresh()
  }

  useEffect(() => {
    if (!fields.length) return
    if (processed.current > points.length) processed.current = 0
    let s = tank
    let changed = false
    for (let i = processed.current; i < points.length; i++) {
      const p = points[i]
      const r = step(s, { lat: p.lat, lng: p.lng, t: p.timestamp }, fields)
      s = r.state
      changed = true
      if (r.autoEmpty) {
        const auto = r.autoEmpty
        void recordTank(auto, 'auto', p)
        setMessage(`${L.item} automatisch gezählt (Feld verlassen): ${fmt0(auto.distM)} m`)
      }
    }
    processed.current = points.length
    if (changed) {
      setTank(s)
      try {
        localStorage.setItem(STATE_KEY(track.id), JSON.stringify(s))
        localStorage.setItem(`${STATE_KEY(track.id)}_n`, String(points.length))
      } catch {
        // ohne localStorage: nur bis zum Neuladen
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, fields])

  const last = points[points.length - 1]
  const here = last ? fieldAt(fields, last) : null
  const field = here ?? fields.find((f) => f.id === mainField(tank)) ?? null
  const speedMs = recentSpeed(points.map((p) => ({ lat: p.lat, lng: p.lng, t: p.timestamp })))

  // Soll-Menge: aus dem Plan für diese Parzelle, sonst Standard
  const planItem = plan?.task.items.find((i) => i.parcel_id === field?.id)
  const planRate = planItem?.amount && planItem.area_a ? planItem.amount / (planItem.area_a / 100) : null
  const target = targetOverride ?? planRate ?? L.defaultRate
  const planEntry = data?.planEntries.find((e) => planItem?.fertilization_ids.includes(e.id))
  const type = data?.types.find((t) => t.id === planEntry?.fertilizer_type_id) ?? (unit === 'm3' ? data?.types.find((t) => t.unit === 'm3') : null) ?? null
  const nutrients = type ? computeNutrients(target, type, num(planEntry?.dilution_factor)) : null

  const targetKmh = flow ? speedFor(flow, target, width) : null
  const actualRate = flow && speedMs && speedMs > 0.3 ? rateAt(flow, speedMs, width) : null
  const tankS = flow ? (tankM3 / flow) * 60 : null
  const restS = tankS != null ? Math.max(0, tankS - tank.spreadS) : null
  const restM = restS != null && speedMs ? restS * speedMs : null
  const advice = field ? planSpreading({ tankM3, widthM: width, flowM3Min: flow, targetM3Ha: target, fieldLengthM: field.lengthM, areaHa: field.areaA ? field.areaA / 100 : null }) : null
  const tankNo = (data?.trackTanks.length ?? 0) + 1
  const diff = targetKmh && speedMs ? kmh(speedMs) - targetKmh : null
  const speedTone = diff == null ? 'text-gray-800' : Math.abs(diff) <= targetKmh! * 0.1 ? 'text-emerald-700' : 'text-amber-700'

  async function tankEmpty() {
    const at = last ? { lat: last.lat, lng: last.lng } : null
    const s = tank
    await recordTank(s, 'knopf', at)
    const rate = s.distM > 0 ? (tankM3 / (s.distM * width)) * 10000 : null
    setMessage(`${L.item} ${tankNo} gespeichert: ${fmt0(s.distM)} m in ${mmss(s.spreadS)}${rate ? ` → ${fmt0(rate)} ${L.unit}/ha` : ''}`)
    const next = { ...emptyTank(), last: s.last }
    setTank(next)
    try {
      localStorage.setItem(STATE_KEY(track.id), JSON.stringify(next))
    } catch {
      // egal
    }
  }

  if (!data || !machine || !LOAD_KINDS.includes(machine.kind) || !tankM3) return null
  return (
    <div className="space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-sm text-gray-800">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">
          {L.icon} {L.item} {tankNo} · {field ? field.name : 'ausserhalb der Parzellen'}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tank.spreading ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
          {tank.spreading ? 'Ausbringen' : here ? 'Wenden / Stillstand' : 'Transport'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded bg-white p-2">
          <div className="text-xs text-gray-500">Tempo</div>
          <div className={`text-3xl font-bold ${speedTone}`}>{speedMs != null ? fmt1(kmh(speedMs)) : '–'}</div>
          <div className="text-xs text-gray-500">km/h · Soll {targetKmh ? fmt1(targetKmh) : '–'}</div>
          {diff != null && targetKmh && Math.abs(diff) > targetKmh * 0.1 && (
            <div className="text-xs font-semibold text-amber-700">{diff < 0 ? 'schneller fahren' : 'langsamer fahren'}</div>
          )}
        </div>
        <div className="rounded bg-white p-2">
          <div className="text-xs text-gray-500">Menge jetzt</div>
          <div className="text-3xl font-bold">{actualRate ? fmt0(actualRate) : '–'}</div>
          <div className="text-xs text-gray-500">
            {L.unit}/ha · Soll{' '}
            <button
              type="button"
              className="font-semibold text-brand-700 underline"
              onClick={() => {
                const v = prompt(`Soll-Menge ${L.unit}/ha`, String(Math.round(target)))
                if (v && Number(v) > 0) setTargetOverride(Number(v))
              }}
            >
              {fmt0(target)}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-gray-600">
        <span>
          in Feldrichtung {fmt0(tank.distM)} m · {mmss(tank.spreadS)}
        </span>
        <span>
          Rest ≈ {restS != null ? mmss(restS) : '–'}
          {restM != null ? ` · ${fmt0(restM)} m` : ''}
        </span>
      </div>
      {advice && advice.options.length > 0 && field?.lengthM && (
        <p className="text-xs text-gray-700">
          Feld {fmt0(field.lengthM)} m, {L.item} reicht {fmt0(advice.distPerTankM)} m:{' '}
          {advice.options.map((o, i) => (
            <span key={o.lanes} className={i === 0 ? 'font-semibold' : ''}>
              {i > 0 ? ' · oder ' : ''}
              {o.lanes} {o.lanes === 1 ? 'Bahn' : 'Bahnen'}/{L.item} → {fmt0(o.rateM3Ha)} {L.unit}/ha{o.speedKmh ? ` bei ${fmt1(o.speedKmh)} km/h` : ''} ({o.deviationPct >= 0 ? '+' : ''}
              {fmt0(o.deviationPct)} %)
            </span>
          ))}
        </p>
      )}
      {nutrients && type && (
        <p className="text-xs text-gray-500">
          {type.name}, {fmt0(target)} {L.unit}/ha ≈ {fmt0(nutrients.n_kg ?? 0)} kg N ({fmt0(nutrients.n_avail_kg ?? 0)} verfügbar) · {fmt0(nutrients.p2o5_kg ?? 0)} P₂O₅ ·{' '}
          {fmt0(nutrients.k2o_kg ?? 0)} K₂O je ha
        </p>
      )}

      <button type="button" onClick={() => void tankEmpty()} className="w-full rounded-xl bg-red-600 py-4 text-lg font-bold text-white active:bg-red-700">
        {L.empty}
      </button>
      {message && <p className="text-center text-xs font-medium text-emerald-800">{message}</p>}
      <p className="text-[11px] text-gray-500">
        Ausfluss {flow ? `${fmt1(flow)} ${L.unit}/min` : 'unbekannt — nach dem ersten Knopfdruck geeicht'}
        {flow ? ` — ${calib.n ? `geeicht aus ${calib.n}× «${L.empty}»${calib.rateM3Ha ? ` (zuletzt ⌀ ${fmt0(calib.rateM3Ha)} ${L.unit}/ha)` : ''}` : `Startwert, wird mit «${L.empty}» geeicht`}` : ''}
        . Ausbringen zählt automatisch bei Fahrt in Feldrichtung; ein vergessener Knopf zählt, wenn das Feld 2 Minuten verlassen wird.
        {accuracyM != null && accuracyM > 10 ? ` GPS ungenau (±${fmt0(accuracyM)} m).` : ''}
      </p>
    </div>
  )
}
