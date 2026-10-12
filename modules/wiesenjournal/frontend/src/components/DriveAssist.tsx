import { useEffect, useMemo, useRef, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { num } from '../lib/format'
import { loadMachines } from '../lib/machines'
import {
  alongTrack,
  crossTrack,
  currentRunStart,
  laneOf,
  nextFreeLane,
  refFromAB,
  refFromField,
  refFromRecent,
  shiftRefTo,
  steer,
  travelSign,
  workedLanes,
  type GuideRef,
  type LanePos,
  type Steer,
} from '../lib/guidance'
import { bearingDeg, emptyTank, fieldAt, fieldShape, rateAt, recentSpeed, speedFor, step, type FieldShape, type TankState } from '../lib/slurry'
import { haversineMeters, type LatLng } from '../lib/geo'
import { setSessionRef } from '../lib/trackingSession'
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

export type AssistParcel = { id: string; name: string; area_a: unknown; base_geometry: string | null; kultur_name_de: string | null; category: string; farm_name: string | null }
export async function loadAssistData(pg: PGlite, seasonYear: number) {
  const [machines, parcels] = await Promise.all([
    loadMachines(pg, false),
    pg.query<AssistParcel>(
      'select id, name, area_a, base_geometry, kultur_name_de, category, farm_name from parcels where season_year = $1 and deleted_at is null and base_geometry is not null',
      [seasonYear],
    ),
  ])
  return { machines, parcels: parcels.rows }
}
export type AssistField = FieldShape & { name: string; areaA: number | null }
export function assistFields(parcels: AssistParcel[]): AssistField[] {
  return parcels
    .map((p) => {
      const s = fieldShape(p.id, p.base_geometry)
      return s ? { ...s, name: p.name, areaA: num(p.area_a) } : null
    })
    .filter((f): f is AssistField => f != null)
}

export const fmt1 = (v: number) => v.toLocaleString('de-CH', { maximumFractionDigits: 1, minimumFractionDigits: 1 })
export const fmt0 = (v: number) => Math.round(v).toLocaleString('de-CH')
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** Gemerkte Einstellungen je Spur (übersteht Umschalten und Neuladen). */
export function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
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
export function Lightbar({ direction, meters, compact = false }: { direction: 'links' | 'rechts' | 'gerade'; meters: number; compact?: boolean }) {
  const lit = direction === 'gerade' ? 0 : Math.min(5, Math.ceil(meters / 0.4))
  const cell = compact ? 'h-4 w-4' : 'h-6 w-6'
  return (
    <div className="flex items-center justify-center gap-1">
      {[5, 4, 3, 2, 1].map((i) => (
        <span key={`l${i}`} className={`${cell} rounded-sm ${direction === 'links' && i <= lit ? 'bg-amber-500' : 'bg-gray-200'}`} />
      ))}
      <span className={`${compact ? 'h-5 w-5' : 'h-8 w-8'} rounded ${direction === 'gerade' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={`r${i}`} className={`${cell} rounded-sm ${direction === 'rechts' && i <= lit ? 'bg-amber-500' : 'bg-gray-200'}`} />
      ))}
    </div>
  )
}

export interface Guidance {
  width: number | null
  ref: GuideRef | null
  setRef: (r: GuideRef | null) => void
  here: AssistField | null
  last: (LatLng & { t: number }) | null
  pts: (LatLng & { t: number })[]
  heading: number | null
  speedMs: number | null
  inFieldSince: number | null
  worked: Set<number>
  pos: LanePos | null
  sign: 1 | -1 | null
  hint: Steer | null
  nextLane: number | null
  gapLane: number | null
  straightAcross: boolean
}

/** Parallelfahren: Bahn, Lenkhinweis, gefahrene Bahnen — für Fahrhilfe,
 * Karte und Badge aus einer Quelle. Nulllinie liegt in der Sitzung. */
export function useGuidance(points: TrackPoint[], fields: AssistField[], width: number | null, ref: GuideRef | null): Guidance {
  const pts = useMemo(() => points.map((p) => ({ lat: p.lat, lng: p.lng, t: p.timestamp })), [points])
  const last = pts[pts.length - 1] ?? null
  const here = last ? (fieldAt(fields, last) as AssistField | null) : null
  const speedMs = recentSpeed(pts)
  // Fahrtrichtung über die letzten ≥ 6 m (ruhiger als Punkt zu Punkt)
  const heading = useMemo(() => {
    if (pts.length < 2) return null
    const end = pts[pts.length - 1]
    for (let i = pts.length - 2; i >= 0; i--) if (haversineMeters(pts[i], end) >= 6) return bearingDeg(pts[i], end)
    return null
  }, [pts])
  // Seit wann ununterbrochen in dieser Parzelle
  const inFieldSince = useMemo(() => {
    if (!here) return null
    let i = pts.length - 1
    while (i > 0 && fieldAt(fields, pts[i - 1])?.id === here.id) i--
    return pts[i]?.t ?? null
  }, [pts, fields, here])
  useEffect(() => {
    // Nulllinie Feldrand der Parzelle, in der man steht — neu erst nach 30 s
    // in einer anderen Parzelle (eine gesetzte A-B-Linie oder Bahn bleibt)
    const settled = inFieldSince != null && last != null && last.t - inFieldSince >= 30_000
    if (width && here && last && (!ref || (ref.source === 'feldrand' && ref.fieldId !== here.id && settled))) {
      const r = refFromField(here, last, width)
      if (r) setSessionRef(r)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, width, here?.id, inFieldSince, last?.t])
  const worked = useMemo(
    () => (ref && width ? workedLanes(ref, pts.slice(0, currentRunStart(ref, pts, width)), width, fields) : new Set<number>()),
    [ref, width, pts, fields],
  )
  // Querabstand geglättet über die letzten 3 Punkte (weniger Zappeln)
  const smooth = useMemo(() => {
    const tail = pts.slice(-3)
    if (!tail.length) return null
    return { lat: tail.reduce((s, p) => s + p.lat, 0) / tail.length, lng: tail.reduce((s, p) => s + p.lng, 0) / tail.length }
  }, [pts])
  const pos = ref && width && smooth ? laneOf(ref, smooth, width) : null
  const sign = ref && heading != null ? travelSign(ref, heading) : null
  const hint = pos && sign ? steer(pos.offsetM, sign) : null
  const nextLane = pos ? nextFreeLane(worked, pos.lane) : null
  const withCurrent = pos ? new Set([...worked, pos.lane]) : worked
  const gapLane = (() => {
    if (!withCurrent.size) return null
    const lo = Math.min(...withCurrent)
    const hi = Math.max(...withCurrent)
    for (let k = lo + 1; k < hi; k++) if (!withCurrent.has(k)) return k
    return null
  })()
  const straightAcross = useMemo(() => {
    if (!ref || heading == null || sign) return false
    const longer = refFromRecent(pts, 25)
    return longer != null && Math.abs((((longer.headingDeg - heading) % 360) + 540) % 360 - 180) < 10
  }, [ref, heading, sign, pts])
  return { width, ref, setRef: setSessionRef, here, last, pts, heading, speedMs, inFieldSince, worked, pos, sign, hint, nextLane, gapLane, straightAcross }
}

/** Kurzer Lenkhinweis für Karte und Badge. */
export function GuidanceStrip({ g }: { g: Guidance }) {
  if (!g.width) return null
  if (!g.ref || !g.pos) return <div className="text-center text-xs text-gray-500">Nulllinie fehlt</div>
  if (!g.hint) return <div className="text-center text-sm font-semibold text-gray-700">Wenden{g.nextLane != null ? ` · nächste Bahn ${g.nextLane}` : ''}</div>
  return (
    <div className="flex items-center justify-center gap-3">
      <Lightbar direction={g.hint.direction} meters={g.hint.meters} compact />
      <span className={`min-w-[4.5rem] text-lg font-bold ${g.hint.direction === 'gerade' ? 'text-emerald-600' : 'text-amber-600'}`}>
        {g.hint.direction === 'gerade' ? 'auf Spur' : `${g.hint.direction === 'links' ? '←' : ''}${fmt1(g.hint.meters)} m${g.hint.direction === 'rechts' ? ' →' : ''}`}
      </span>
      <span className="text-xs text-gray-500">Bahn {g.pos.lane}</span>
    </div>
  )
}

/** Kleine Bahnenkarte, Fahrtrichtung oben: Bahnen als senkrechte Linien,
 * gefahrene Bahnen gefüllt, eigene Spur, Traktor in der Mitte. */
export function LaneMiniMap({ g, heightM = 70 }: { g: Guidance; heightM?: number }) {
  const { ref, width, last } = g
  if (!ref || !width || !last) return null
  const W = 300
  const H = 200
  const s = H / heightM
  const dir = g.sign ?? 1
  const c0 = crossTrack(ref, last)
  const a0 = alongTrack(ref, last)
  const X = (c: number) => W / 2 + (c - c0) * dir * s
  const Y = (a: number) => H * 0.65 - (a - a0) * dir * s
  const lo = Math.floor((c0 - W / 2 / s) / width) - 1
  const hi = Math.ceil((c0 + W / 2 / s) / width) + 1
  const lanes = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  const tail = g.pts.slice(-600).filter((p) => Math.abs(crossTrack(ref, p) - c0) < heightM * 2 && Math.abs(alongTrack(ref, p) - a0) < heightM * 2)
  const path = tail.map((p, i) => `${i ? 'L' : 'M'}${X(crossTrack(ref, p)).toFixed(1)} ${Y(alongTrack(ref, p)).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-lime-50" role="img" aria-label="Bahnen um den Traktor">
      {lanes.map((k) => {
        const x = X(k * width)
        const band = width * s
        return (
          <g key={k}>
            {g.worked.has(k) && <rect x={x - band / 2} y={0} width={band} height={H} fill="#86efac" opacity={0.7} />}
            <line x1={x} y1={0} x2={x} y2={H} stroke={k === g.pos?.lane ? '#047857' : '#94a3b8'} strokeWidth={k === g.pos?.lane ? 2 : 1} strokeDasharray={k === 0 ? '0' : '6 4'} />
            {(band >= 16 || k % 5 === 0 || k === g.pos?.lane) && (
              <text x={x + 3} y={12} fontSize={10} fill="#334155">
                {k}
              </text>
            )}
          </g>
        )
      })}
      {path && <path d={path} fill="none" stroke="#7c3aed" strokeWidth={Math.max(2, Math.min(width * s, 30))} strokeOpacity={0.25} strokeLinecap="round" strokeLinejoin="round" />}
      {path && <path d={path} fill="none" stroke="#7c3aed" strokeWidth={1.5} />}
      <path d={`M${W / 2} ${H * 0.65 - 12} l8 18 l-8 -5 l-8 5 z`} fill="#111827" />
    </svg>
  )
}

/** Nulllinie wählen: A-B (zwei Punkte), letzte 30 m, Feldrand; nachziehen. */
export function NullLine({ g, storageKey }: { g: Guidance; storageKey: string }) {
  const [a, setA] = useStored<LatLng | null>(`${storageKey}_A`, null)
  const [msg, setMsg] = useState<string | null>(null)
  if (!g.width) return <p className="text-sm text-gray-500">Für Parallelfahren eine Arbeitsbreite angeben (Register «Gerät»).</p>
  const fromA = a && g.last ? haversineMeters(a, g.last) : null
  const desc = !g.ref
    ? 'noch keine'
    : g.ref.source === 'ab'
      ? `A-B-Linie (${fmt0(haversineMeters(g.ref.a!, g.ref.b!))} m)`
      : g.ref.source === 'feldrand'
        ? `Feldrand ${g.here && g.ref.fieldId === g.here.id ? g.here.name : ''}`
        : 'gefahrene Bahn'
  const btn = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium active:bg-gray-100 disabled:opacity-40'
  return (
    <div className="space-y-2 text-sm">
      <div>
        Nulllinie: <b>{desc}</b>
        {g.ref ? ` · Richtung ${fmt0(g.ref.headingDeg)}°` : ''}
      </div>
      {!a ? (
        <div className="space-y-1 rounded-lg bg-sky-50 p-2">
          <div className="font-medium text-sky-900">A-B-Linie (empfohlen)</div>
          <ol className="list-decimal pl-5 text-xs text-sky-900">
            <li>An den Anfang der ersten Bahn fahren, «A setzen».</li>
            <li>Gerade bis ans Bahnende fahren.</li>
            <li>«B setzen» — diese Bahn ist jetzt Bahn 0.</li>
          </ol>
          <button type="button" className={btn} disabled={!g.last} onClick={() => g.last && setA({ lat: g.last.lat, lng: g.last.lng })}>
            A setzen (hier)
          </button>
        </div>
      ) : (
        <div className="space-y-1 rounded-lg bg-sky-50 p-2">
          <div className="font-medium text-sky-900">A gesetzt · {fromA != null ? `${fmt0(fromA)} m gefahren` : '…'}</div>
          <div className="text-xs text-sky-900">Gerade bis ans Bahnende fahren, dann B setzen (mind. 20 m).</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${btn} border-sky-600 bg-sky-600 text-white`}
              disabled={!g.last || (fromA ?? 0) < 20}
              onClick={() => {
                const r = g.last ? refFromAB(a, g.last) : null
                if (r) {
                  g.setRef(r)
                  setA(null)
                  setMsg('A-B-Linie gesetzt: Bahn 0.')
                }
              }}
            >
              B setzen (hier)
            </button>
            <button type="button" className={btn} onClick={() => setA(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => {
            const r = refFromRecent(g.pts)
            if (r) {
              g.setRef(r)
              setMsg('Letzte 30 m sind jetzt Bahn 0.')
            } else setMsg('Erst ein gerades Stück von 30 m fahren.')
          }}
        >
          Letzte 30 m = Bahn 0
        </button>
        {g.here && g.last && (
          <button type="button" className={btn} onClick={() => g.setRef(refFromField(g.here!, g.last!, g.width!))}>
            Ab Feldrand
          </button>
        )}
        {g.ref && g.last && (
          <button
            type="button"
            className={btn}
            onClick={() => {
              g.setRef(shiftRefTo(g.ref!, g.last!, g.width!))
              setMsg('Nulllinie nachgezogen: du bist jetzt auf der Bahnmitte.')
            }}
          >
            Hier = Bahnmitte
          </button>
        )}
      </div>
      {msg && <p className="text-xs text-emerald-700">{msg}</p>}
      <p className="text-[11px] text-gray-500">«Hier = Bahnmitte» gleicht GPS-Abdrift aus, wenn du sicher in der Spur fährst (z.B. Anschlussfahren an der letzten Bahn).</p>
    </div>
  )
}

/** Fahrhilfe: Lichtbalken, Bahn, kleine Bahnenkarte, Tempo und je Arbeit
 * die passende Hilfe — Behälter (Gülle, Kalk, Mist), Verschlauchung
 * (Pumpe), Säen (Saatgut), Mähen (Restgras), sonst Fläche und Wunschtempo. */
export default function DriveAssist({
  track,
  points,
  accuracyM,
  seasonYear,
  plan,
  g,
  fields,
  machine,
  parcels,
  focus,
}: {
  track: Track
  points: TrackPoint[]
  accuracyM: number | null
  seasonYear: number
  plan: ActivePlan | null
  g: Guidance
  fields: AssistField[]
  machine: Machine | null
  parcels: AssistParcel[]
  /** Karte gross statt Lichtbalken */
  focus: 'lenken' | 'karte'
}) {
  const width = g.width
  const mode = assistMode(track.work_type, machine)
  const key = `wiesenjournal_assist_${track.id}`
  const { pts, here, pos, hint, sign, worked, nextLane, gapLane, straightAcross, inFieldSince, last, speedMs } = g

  const mowParcels = useMemo(
    () =>
      parcels.map((p) => ({
        id: p.id,
        name: p.name,
        base_geometry: p.base_geometry,
        area_a: num(p.area_a),
        farm_name: p.farm_name,
        kultur_name_de: p.kultur_name_de,
        bff: matchesVirtualCategory(p as unknown as Parcel, 'bff'),
      })),
    [parcels],
  )

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
  if (work.current.n > pts.length) work.current = { state: emptyTank(), n: 0 }
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
  const pumpM3h = pumpStored ?? (machine?.flow_m3_min ? machine.flow_m3_min * 60 : null)
  const [seedKgHa, setSeedKgHa] = useStored<number | null>(`${key}_seed`, null)
  const ask = (label: string, current: number | null, set: (v: number | null) => void) => {
    const v = prompt(label, current != null ? String(current) : '')
    if (v == null) return
    const n = Number(v.replace(',', '.'))
    set(v.trim() === '' || !Number.isFinite(n) || n <= 0 ? null : n)
  }

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
    <div className="mx-auto w-full max-w-xl space-y-3">
      {/* Parallelfahren */}
      {width ? (
        <section className="space-y-2 rounded-xl border p-3 text-center">
          {!g.ref ? (
            <p className="text-sm text-gray-500">Noch keine Nulllinie: im Feld startet sie am Feldrand, oder im Register «Gerät» eine A-B-Linie setzen.</p>
          ) : sign && hint && pos ? (
            <>
              {focus === 'lenken' && <Lightbar direction={hint.direction} meters={hint.meters} />}
              <div className={`${focus === 'lenken' ? 'text-5xl' : 'text-3xl'} font-bold ${hint.direction === 'gerade' ? 'text-emerald-600' : 'text-amber-600'}`}>
                {hint.direction === 'gerade' ? 'auf Spur' : hint.direction === 'links' ? `← ${fmt1(hint.meters)} m` : `${fmt1(hint.meters)} m →`}
              </div>
              <div className="text-sm text-gray-600">
                Bahn {pos.lane}
                {worked.has(pos.lane) ? <span className="ml-1 rounded bg-red-100 px-1 text-red-800">schon gefahren</span> : null}
              </div>
              {gapLane != null && <div className="rounded bg-yellow-100 px-2 py-1 text-sm font-medium text-yellow-900">Lücke: Bahn {gapLane} noch nicht gefahren</div>}
            </>
          ) : straightAcross ? (
            <div className="py-2 text-sm">
              <div className="text-lg font-semibold">Fahrtrichtung quer zur Nulllinie</div>
              Für Bahnen in dieser Richtung im Register «Gerät» eine neue Nulllinie setzen.
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
          <LaneMiniMap g={g} heightM={focus === 'karte' ? 140 : 70} />
          <div className="text-xs text-gray-600">
            {worked.size} {worked.size === 1 ? 'Bahn' : 'Bahnen'} gefahren · {here ? here.name : 'ausserhalb Parzelle'}
          </div>
        </section>
      ) : (
        <p className="rounded-xl border p-3 text-sm text-gray-500">Für Parallelfahren im Register «Gerät» eine Arbeitsbreite angeben.</p>
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
            {here?.areaA && workedAreaHa != null ? ` · ${fmt0(Math.min(100, ((workedAreaHa * 10000) / (here.areaA * 100)) * 100))} % von ${here.name}` : ''}
          </p>
        </section>
      )}

      <p className="text-[11px] text-gray-500">
        Bahnen und Fläche zählen bei Fahrt in Feldrichtung. Handy-GPS ist auf ±3–5 m genau: der Lichtbalken hilft gegen ausgelassene und doppelte
        Bahnen, nicht für Zentimeter.
      </p>
    </div>
  )
}

