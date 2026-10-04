import { useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { num } from '../lib/format'
import { loadMachines } from '../lib/machines'
import { currentRunStart, laneOf, nextFreeLane, refFromField, refFromRecent, steer, travelSign, workedLanes, type GuideRef } from '../lib/guidance'
import { bearingDeg, emptyTank, fieldAt, fieldShape, rateAt, recentSpeed, speedFor, step, type FieldShape, type TankState } from '../lib/slurry'
import { haversineMeters } from '../lib/geo'
import SlurryPanel from './SlurryPanel'
import MowPanel from './MowPanel'
import { matchesVirtualCategory } from '../lib/parcelFilter'
import type { ActivePlan } from '../lib/workPlan'
import type { TrackPoint } from '../lib/tracking'
import type { Machine, Parcel, Track } from '../types'

/** Welche Hilfe zur Arbeit passt. */
export type AssistMode = 'load' | 'hose' | 'seed' | 'mow' | 'area'

export function assistMode(workType: string | null, machine: Machine | null): AssistMode {
  const w = (workType ?? '').toLowerCase()
  if (machine?.kind === 'verschlauchung' || w.includes('verschlauch')) return 'hose'
  if (machine && ['guellefass', 'duengerstreuer', 'miststreuer'].includes(machine.kind) && machine.capacity) return 'load'
  if (w.includes('säen') || w.includes('saat') || (machine && ['saemaschine', 'saatkombination'].includes(machine.kind))) return 'seed'
  if (w.includes('mäh') || (machine && ['maehwerk', 'motormaeher'].includes(machine.kind))) return 'mow'
  return 'area'
}

async function load(pg: PGlite, seasonYear: number) {
  const [machines, parcels] = await Promise.all([
    loadMachines(pg, false),
    pg.query<{ id: string; name: string; area_a: unknown; base_geometry: string | null; kultur_name_de: string | null; category: string; farm_name: string | null }>(
      'select id, name, area_a, base_geometry, kultur_name_de, category, farm_name from parcels where season_year = $1 and deleted_at is null and base_geometry is not null',
      [seasonYear],
    ),
  ])
  return { machines, parcels: parcels.rows }
}

const fmt1 = (v: number) => v.toLocaleString('de-CH', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
const fmt0 = (v: number) => Math.round(v).toLocaleString('de-CH')
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Gemerkte Einstellungen je Spur (übersteht Umschalten und Neuladen). */
function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  return [
    v,
    (next: T) => {
      setV(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // nur im Speicher
      }
    },
  ]
}

/** Lichtbalken: leuchtet auf der Seite, auf die gelenkt werden soll. */
function Lightbar({ direction, meters }: { direction: 'links' | 'rechts' | 'gerade'; meters: number }) {
  const lit = direction === 'gerade' ? 0 : Math.min(5, Math.ceil(meters / 0.4))
  return (
    <div className="flex items-center justify-center gap-1">
      {[5, 4, 3, 2, 1].map((i) => (
        <span key={`l${i}`} className={`h-6 w-6 rounded-sm ${direction === 'links' && i <= lit ? 'bg-amber-500' : 'bg-gray-200'}`} />
      ))}
      <span className={`h-8 w-8 rounded ${direction === 'gerade' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={`r${i}`} className={`h-6 w-6 rounded-sm ${direction === 'rechts' && i <= lit ? 'bg-amber-500' : 'bg-gray-200'}`} />
      ))}
    </div>
  )
}

/** Vollbild-Fahrhilfe während der Aufzeichnung: Parallelfahren (Bahnen mit
 * Arbeitsbreite, Lichtbalken, nächste freie Bahn) und je Arbeit die
 * passende Hilfe — Behälter (Gülle, Kalk, Mist), Verschlauchung (Pumpe),
 * Säen (Saatgut), sonst Fläche und Wunschtempo. */
export default function DriveAssist({
  track,
  points,
  accuracyM,
  seasonYear,
  plan,
  onClose,
  onStop,
}: {
  track: Track
  points: TrackPoint[]
  accuracyM: number | null
  seasonYear: number
  plan: ActivePlan | null
  onClose: () => void
  onStop: () => void
}) {
  const { data } = useQuery((pg) => load(pg, seasonYear), [seasonYear])
  const machine = data?.machines.find((m) => m.id === track.machine_id) ?? null
  const width = Number(track.width_m ?? machine?.width_m ?? 0) || null
  const mode = assistMode(track.work_type, machine)
  const key = `wiesenjournal_assist_${track.id}`

  const fields = useMemo<(FieldShape & { name: string; areaA: number | null })[]>(
    () =>
      (data?.parcels ?? [])
        .map((p) => {
          const s = fieldShape(p.id, p.base_geometry)
          return s ? { ...s, name: p.name, areaA: num(p.area_a) } : null
        })
        .filter((f): f is NonNullable<typeof f> => f != null),
    [data],
  )

  const mowParcels = useMemo(
    () =>
      (data?.parcels ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        base_geometry: p.base_geometry,
        area_a: num(p.area_a),
        farm_name: p.farm_name,
        kultur_name_de: p.kultur_name_de,
        bff: matchesVirtualCategory(p as unknown as Parcel, 'bff'),
      })),
    [data],
  )
  const pts = useMemo(() => points.map((p) => ({ lat: p.lat, lng: p.lng, t: p.timestamp })), [points])
  const last = pts[pts.length - 1] ?? null
  const here = last ? fieldAt(fields, last) : null
  const speedMs = recentSpeed(pts)
  // Fahrtrichtung über die letzten ≥ 6 m (ruhiger als Punkt zu Punkt)
  const heading = useMemo(() => {
    if (pts.length < 2) return null
    const end = pts[pts.length - 1]
    for (let i = pts.length - 2; i >= 0; i--) if (haversineMeters(pts[i], end) >= 6) return bearingDeg(pts[i], end)
    return null
  }, [pts])

  // --- Parallelfahren ---
  const [ref, setRef] = useStored<GuideRef | null>(`${key}_ref`, null)
  // Seit wann ununterbrochen in dieser Parzelle (kurzes Streifen der
  // Nachbarparzelle am Rand soll die Referenz nicht umwerfen)
  const inFieldSince = useMemo(() => {
    if (!here) return null
    let i = pts.length - 1
    while (i > 0 && fieldAt(fields, pts[i - 1])?.id === here.id) i--
    return pts[i]?.t ?? null
  }, [pts, fields, here])
  useEffect(() => {
    // Referenz Feldrand der Parzelle, in der man steht — neu erst nach 30 s
    // in einer anderen Parzelle (eine gesetzte Bahn bleibt)
    const settled = inFieldSince != null && last != null && last.t - inFieldSince >= 30_000
    if (width && here && last && (!ref || (ref.source === 'feldrand' && ref.fieldId !== here.id && settled))) {
      const r = refFromField(here, last, width)
      if (r) setRef(r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, width, here?.id, inFieldSince, last?.t])
  // Gefahrene Bahnen ohne die laufende Fahrt (sonst wäre die eigene Bahn
  // gleich «schon gefahren»)
  const worked = useMemo(
    () => (ref && width ? workedLanes(ref, pts.slice(0, currentRunStart(ref, pts, width)), width, fields) : new Set<number>()),
    [ref, width, pts, fields],
  )
  const pos = ref && width && last ? laneOf(ref, last, width) : null
  const sign = ref && heading != null ? travelSign(ref, heading) : null
  const hint = pos && sign ? steer(pos.offsetM, sign) : null
  const nextLane = pos ? nextFreeLane(worked, pos.lane) : null
  // Ausgelassene Bahn zwischen gefahrenen
  // (die laufende Bahn zählt für die Lückensuche mit)
  const withCurrent = pos ? new Set([...worked, pos.lane]) : worked
  const gapLane = (() => {
    if (!withCurrent.size) return null
    const lo = Math.min(...withCurrent)
    const hi = Math.max(...withCurrent)
    for (let k = lo + 1; k < hi; k++) if (!withCurrent.has(k)) return k
    return null
  })()
  // Gerade unterwegs, aber quer zur Referenz (nicht am Wenden)?
  const straightAcross = useMemo(() => {
    if (!ref || heading == null || sign) return false
    const longer = refFromRecent(pts, 25)
    return longer != null && Math.abs((((longer.headingDeg - heading) % 360) + 540) % 360 - 180) < 10
  }, [ref, heading, sign, pts])

  // --- Arbeitsstrecke (in Feldrichtung, wie beim Güllefass) ---
  const work = useRef<{ state: TankState; n: number }>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(`${key}_work`) ?? '') as { state: TankState; n: number }
      } catch {
        return { state: emptyTank(), n: 0 }
      }
    })(),
  )
  if (fields.length && work.current.n < pts.length) {
    let s = work.current.state
    for (let i = work.current.n; i < pts.length; i++) s = step(s, pts[i], fields).state
    work.current = { state: s, n: pts.length }
    try {
      localStorage.setItem(`${key}_work`, JSON.stringify(work.current))
    } catch {
      // egal
    }
  }
  const workedAreaHa = width ? (work.current.state.distM * width) / 10000 : null
  const workedS = work.current.state.spreadS

  // --- Einstellungen je Arbeit ---
  const [target, setTarget] = useStored<number | null>(`${key}_target`, null)
  const [pumpStored, setPumpM3h] = useStored<number | null>(`wiesenjournal_pump_${track.machine_id ?? 'x'}`, null)
  // Pumpenleistung: hier eingetragen, sonst Ausfluss aus der Maschinenliste
  const pumpM3h = pumpStored ?? (machine?.flow_m3_min ? machine.flow_m3_min * 60 : null)
  const [seedKgHa, setSeedKgHa] = useStored<number | null>(`${key}_seed`, null)
  const ask = (label: string, current: number | null, set: (v: number | null) => void) => {
    const v = prompt(label, current != null ? String(current) : '')
    if (v == null) return
    const n = Number(v.replace(',', '.'))
    set(v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n)
  }

  // Verschlauchung: Pumpe m³/h → Soll-Tempo für die Wunschmenge
  const planItem = plan?.task.items.find((i) => i.parcel_id === here?.id)
  const planRate = planItem?.amount && planItem.area_a ? planItem.amount / (planItem.area_a / 100) : null
  const hoseTarget = target ?? planRate ?? 25
  const hoseFlow = pumpM3h ? pumpM3h / 60 : null
  const hoseSpeed = hoseFlow && width ? speedFor(hoseFlow, hoseTarget, width) : null
  const hoseRate = hoseFlow && width && speedMs && speedMs > 0.3 ? rateAt(hoseFlow, speedMs, width) : null
  const kmh = speedMs != null ? speedMs * 3.6 : null
  const wishKmh = mode === 'hose' ? hoseSpeed : mode === 'area' || mode === 'seed' ? target : null
  const tone = wishKmh && kmh != null ? (Math.abs(kmh - wishKmh) <= wishKmh * 0.1 ? 'text-emerald-700' : 'text-amber-700') : 'text-gray-900'

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col overflow-y-auto bg-white text-gray-900">
      <div className="flex items-center justify-between gap-2 border-b bg-gray-50 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">🧭 {track.work_type ?? 'Fahrhilfe'}</div>
          <div className="truncate text-xs text-gray-500">
            {track.machine ?? 'ohne Gerät'}
            {width ? ` · ${fmt1(width)} m` : ''} · {here ? here.name : 'ausserhalb'}
            {accuracyM != null ? ` · GPS ±${fmt0(accuracyM)} m` : ''}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            Karte
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Aufzeichnung beenden?')) onStop()
            }}
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white"
          >
            ⏹ Stop
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-xl flex-1 space-y-3 p-3">
        {/* Parallelfahren */}
        {width ? (
          <section className="space-y-2 rounded-xl border p-3 text-center">
            {!ref ? (
              <p className="text-sm text-gray-500">Parallelfahren startet, sobald du in einer Parzelle bist (Bahnen ab Feldrand).</p>
            ) : sign && hint && pos ? (
              <>
                <Lightbar direction={hint.direction} meters={hint.meters} />
                <div className={`text-5xl font-bold ${hint.direction === 'gerade' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {hint.direction === 'gerade' ? 'auf Spur' : hint.direction === 'links' ? `← ${fmt1(hint.meters)} m` : `${fmt1(hint.meters)} m →`}
                </div>
                <div className="text-sm text-gray-600">
                  Bahn {pos.lane}
                  {worked.has(pos.lane) ? <span className="ml-1 rounded bg-red-100 px-1 text-red-800">schon gefahren</span> : null}
                </div>
                {gapLane != null && (
                  <div className="rounded bg-yellow-100 px-2 py-1 text-sm font-medium text-yellow-900">Lücke: Bahn {gapLane} noch nicht gefahren</div>
                )}
              </>
            ) : straightAcross ? (
              <div className="py-2 text-sm">
                <div className="text-lg font-semibold">Fahrtrichtung quer zur Referenz</div>
                Für Bahnen in dieser Richtung: «Diese Bahn = Bahn 0» antippen.
              </div>
            ) : (
              <div className="py-2">
                <div className="text-lg font-semibold">Wenden</div>
                {nextLane != null && pos && (
                  <div className="text-3xl font-bold text-brand-700">
                    nächste freie Bahn {nextLane}
                    <span className="block text-base font-normal text-gray-600">{fmt1(Math.abs((nextLane - pos.lane) * width - pos.offsetM))} m quer von hier</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-gray-600">
              <span>
                Referenz: {ref ? (ref.source === 'feldrand' ? 'Feldrand' : 'gefahrene Bahn') : '–'} · {worked.size} {worked.size === 1 ? 'Bahn' : 'Bahnen'} gefahren
              </span>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1"
                onClick={() => {
                  const r = refFromRecent(pts)
                  if (r) setRef(r)
                  else alert('Erst ein gerades Stück von 30 m fahren.')
                }}
              >
                Diese Bahn = Bahn 0
              </button>
              {here && last && (
                <button type="button" className="rounded border border-gray-300 px-2 py-1" onClick={() => setRef(refFromField(here, last, width))}>
                  Ab Feldrand
                </button>
              )}
            </div>
          </section>
        ) : (
          <p className="rounded-xl border p-3 text-sm text-gray-500">Für Parallelfahren beim Start eine Arbeitsbreite angeben.</p>
        )}

        {/* Tempo */}
        <section className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 p-2">
            <div className="text-xs text-gray-500">Tempo km/h</div>
            <div className={`text-4xl font-bold ${tone}`}>{kmh != null ? fmt1(kmh) : '–'}</div>
            {wishKmh ? <div className="text-xs text-gray-500">Soll {fmt1(wishKmh)}</div> : null}
          </div>
          <div className="rounded-xl bg-gray-50 p-2">
            <div className="text-xs text-gray-500">bearbeitet</div>
            <div className="text-4xl font-bold">{workedAreaHa != null ? fmt1(workedAreaHa * 100) : '–'}</div>
            <div className="text-xs text-gray-500">a · {mmss(workedS)}</div>
          </div>
        </section>

        {/* je Arbeit */}
        {mode === 'load' && <SlurryPanel track={track} points={points} seasonYear={seasonYear} plan={plan} accuracyM={accuracyM} />}

        {mode === 'hose' && (
          <section className="space-y-1 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="font-semibold">Verschlauchung</div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded bg-white p-2">
                <div className="text-xs text-gray-500">Menge jetzt m³/ha</div>
                <div className="text-3xl font-bold">{hoseRate ? fmt0(hoseRate) : '–'}</div>
                <button type="button" className="text-xs text-brand-700 underline" onClick={() => ask('Soll-Menge m³/ha', hoseTarget, setTarget)}>
                  Soll {fmt0(hoseTarget)}
                </button>
              </div>
              <div className="rounded bg-white p-2">
                <div className="text-xs text-gray-500">Pumpe m³/h</div>
                <div className="text-3xl font-bold">{pumpM3h ? fmt0(pumpM3h) : '–'}</div>
                <button type="button" className="text-xs text-brand-700 underline" onClick={() => ask('Pumpenleistung m³/h (Durchfluss)', pumpM3h, setPumpM3h)}>
                  ändern
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-600">
              {hoseFlow ? `Bisher ≈ ${fmt1((hoseFlow * workedS) / 60)} m³ ausgebracht (Zeit in Feldrichtung × Pumpe).` : 'Pumpenleistung eintragen — dann Soll-Tempo und Menge.'} Nach der Arbeit den
              Zählerstand der Pumpe vergleichen und die Pumpenleistung anpassen.
            </p>
          </section>
        )}

        {mode === 'seed' && (
          <section className="space-y-1 rounded-xl border-2 border-lime-300 bg-lime-50 p-3 text-sm">
            <div className="font-semibold">Säen</div>
            <p>
              Saatmenge{' '}
              <button type="button" className="font-semibold text-brand-700 underline" onClick={() => ask('Saatmenge kg/ha (gemäss Abdrehprobe)', seedKgHa, setSeedKgHa)}>
                {seedKgHa ? `${fmt0(seedKgHa)} kg/ha` : 'eintragen'}
              </button>
              {seedKgHa && workedAreaHa != null ? ` · bisher ≈ ${fmt1(seedKgHa * workedAreaHa)} kg Saatgut` : ''}
              {seedKgHa && here?.areaA ? ` · ganze Parzelle ≈ ${fmt0((seedKgHa * here.areaA) / 100)} kg` : ''}
            </p>
            <p className="text-xs text-gray-600">
              Wunschtempo{' '}
              <button type="button" className="text-brand-700 underline" onClick={() => ask('Wunschtempo km/h', target, setTarget)}>
                {target ? `${fmt1(target)} km/h` : 'festlegen'}
              </button>{' '}
              — bodenangetriebene Sämaschinen säen unabhängig vom Tempo, zu schnell leidet aber die Ablage.
            </p>
          </section>
        )}

        {mode === 'mow' && width && (
          <MowPanel
            storageKey={key}
            parcels={mowParcels}
            hereId={here?.id ?? null}
            settledId={here && inFieldSince != null && last && last.t - inFieldSince >= 20_000 ? here.id : null}
            points={pts}
            widthM={width}
          />
        )}

        {mode === 'area' && (
          <section className="space-y-1 rounded-xl border p-3 text-sm">
            <p>
              Wunschtempo{' '}
              <button type="button" className="font-semibold text-brand-700 underline" onClick={() => ask('Wunschtempo km/h', target, setTarget)}>
                {target ? `${fmt1(target)} km/h` : 'festlegen'}
              </button>
              {here?.areaA && workedAreaHa != null ? ` · ${fmt0(Math.min(100, (workedAreaHa * 10000) / (here.areaA * 100) * 100))} % von ${here.name}` : ''}
            </p>
          </section>
        )}

        <p className="text-[11px] text-gray-500">
          Bahnen und Fläche zählen bei Fahrt in Feldrichtung. Handy-GPS ist auf ±3–5 m genau: der Lichtbalken hilft gegen ausgelassene und
          doppelte Bahnen, nicht für Zentimeter. Bildschirm bleibt an — Ladekabel anschliessen.
        </p>
      </div>
    </div>
  )
}
