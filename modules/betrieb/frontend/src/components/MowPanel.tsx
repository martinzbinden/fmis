import { useEffect, useMemo, useRef, useState } from 'react'
import { createGrid, mowPoints, mownPct, mowState, type MowGrid, type MowState } from '../lib/mowing'
import type { LatLng } from '../lib/geo'
import ParcelPicker, { type PickParcel } from './ParcelPicker'

export type MowParcel = PickParcel & { bff: boolean }

const fmt0 = (v: number) => Math.round(v).toLocaleString('de-CH')

function stored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function store(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // nur im Speicher
  }
}

/** Kurzer Ton (falls der Browser es erlaubt) und Vibration. */
function alarm(strong: boolean) {
  try {
    navigator.vibrate?.(strong ? [300, 150, 300, 150, 300] : [200])
  } catch {
    // ohne Vibration
  }
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = strong ? 880 : 660
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (strong ? 0.6 : 0.25))
  } catch {
    // ohne Ton
  }
}

/** Kleine Karte der Parzelle: gemäht grün, stehen gelb, Traktor als Punkt. */
function GridCanvas({ grid, version, at }: { grid: MowGrid; version: number; at: LatLng | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const W = 320
    const scale = W / grid.cols
    const H = Math.max(40, Math.min(360, Math.round(grid.rows * scale)))
    const sy = H / grid.rows
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const i = r * grid.cols + c
        if (!grid.inside[i]) continue
        ctx.fillStyle = grid.mown[i] ? '#22c55e' : '#fde68a'
        // Norden oben
        ctx.fillRect(Math.floor(c * scale), Math.floor(H - (r + 1) * sy), Math.ceil(scale), Math.ceil(sy))
      }
    }
    if (at) {
      const x = ((at.lng - grid.origin.lng) * Math.PI * 6371000 * Math.cos((grid.origin.lat * Math.PI) / 180)) / 180 / grid.cellM
      const y = ((at.lat - grid.origin.lat) * Math.PI * 6371000) / 180 / grid.cellM
      ctx.fillStyle = '#1d4ed8'
      ctx.beginPath()
      ctx.arc(x * scale, H - y * sy, 5, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [grid, version, at])
  return <canvas ref={ref} className="mx-auto block w-full max-w-[320px] rounded" />
}

const STATE_STYLE: Record<MowState, string> = {
  ok: 'border-emerald-300 bg-emerald-50',
  bald: 'border-amber-400 bg-amber-50',
  grenze: 'border-red-500 bg-red-50',
}

/** Mähen mit Restgras: Parzelle wählen, Restgras %, gemähter Anteil aus
 * Spur × Arbeitsbreite, Warnung vor der Grenze (Ton/Vibration). */
export default function MowPanel({
  storageKey,
  parcels,
  hereId,
  settledId,
  points,
  widthM,
}: {
  storageKey: string
  parcels: MowParcel[]
  hereId: string | null
  /** Parzelle, in der man seit mindestens 20 s ununterbrochen ist */
  settledId: string | null
  points: (LatLng & { t: number })[]
  widthM: number
}) {
  const [parcelId, setParcelIdState] = useState<string | null>(() => stored(`${storageKey}_mowparcel`, null))
  const parcel = parcels.find((p) => p.id === (parcelId ?? hereId)) ?? null
  const [restPct, setRestPctState] = useState<number | null>(() => stored(`${storageKey}_rest`, null))
  // BFF: 10 % Rückzugsstreifen als Vorschlag
  const rest = restPct ?? (parcel?.bff ? 10 : 0)
  const setParcelId = (id: string) => {
    setParcelIdState(id)
    store(`${storageKey}_mowparcel`, id)
  }
  // Parzelle festhalten, sobald man darin ist — beim Wenden ausserhalb soll
  // sie nicht wegfallen (sonst Neuberechnung und doppelte Warnung)
  useEffect(() => {
    if (!parcelId && settledId) setParcelId(settledId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelId, settledId])
  const setRestPct = (v: number) => {
    setRestPctState(v)
    store(`${storageKey}_rest`, v)
  }

  // Raster der Parzelle, fortlaufend aus den Punkten gemäht
  const grid = useMemo(() => (parcel?.base_geometry ? createGrid(parcel.base_geometry) : null), [parcel?.id, parcel?.base_geometry])
  const progress = useRef<{ grid: MowGrid | null; n: number; heading: number | null }>({ grid: null, n: 0, heading: null })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!grid) return
    if (progress.current.grid !== grid) progress.current = { grid, n: 1, heading: null }
    if (points.length > progress.current.n) {
      progress.current.heading = mowPoints(grid, points, widthM, progress.current.n, progress.current.heading)
      progress.current.n = points.length
      setVersion((v) => v + 1)
    }
  }, [grid, points, widthM])

  const pct = grid ? mownPct(grid) : 0
  const limit = 100 - rest
  const state = mowState(pct, rest)
  const lastState = useRef<MowState>('ok')
  useEffect(() => {
    if (state !== lastState.current && state !== 'ok' && rest > 0) alarm(state === 'grenze')
    lastState.current = state
  }, [state, rest])

  const cellArea = grid ? grid.cellM * grid.cellM : 1
  const totalM2 = grid ? grid.insideCount * cellArea : 0
  const leftToLimitM2 = Math.max(0, ((limit - pct) / 100) * totalM2)
  const last = points[points.length - 1] ?? null

  return (
    <section className={`space-y-2 rounded-xl border-2 p-3 text-sm ${STATE_STYLE[state]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Mähen</span>
        <ParcelPicker parcels={parcels} selectedId={parcel?.id ?? null} here={last} onPick={setParcelId} label="Zu mähende Parzelle" />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-gray-600">Restgras stehen lassen:</span>
        {[0, 5, 10, 15, 20].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setRestPct(v)}
            className={`rounded px-2 py-1 text-xs ${rest === v ? 'bg-brand-700 text-white' : 'border border-gray-300 bg-white text-gray-700'}`}
          >
            {v} %
          </button>
        ))}
      </div>

      {!parcel ? (
        <p className="text-xs text-gray-600">Parzelle wählen — oder in die Parzelle fahren.</p>
      ) : !grid ? (
        <p className="text-xs text-gray-600">Parzelle ohne Umriss — hier kann nicht gerechnet werden.</p>
      ) : (
        <>
          <div className="text-center">
            <div className={`text-5xl font-bold ${state === 'grenze' ? 'text-red-700' : state === 'bald' ? 'text-amber-700' : 'text-emerald-700'}`}>{fmt0(pct)} %</div>
            <div className="text-xs text-gray-600">
              gemäht von {parcel.name} ({fmt0(totalM2 / 100)} a){rest > 0 ? ` · Grenze ${limit} %` : ''}
            </div>
          </div>
          <div className="relative h-4 overflow-hidden rounded bg-white">
            <div className={`h-full ${state === 'grenze' ? 'bg-red-500' : state === 'bald' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
            {rest > 0 && <div className="absolute inset-y-0 w-0.5 bg-gray-900" style={{ left: `${limit}%` }} />}
          </div>
          {rest > 0 &&
            (state === 'grenze' ? (
              <div className="rounded bg-red-600 px-2 py-2 text-center text-base font-bold text-white">Grenze erreicht — Rest stehen lassen!</div>
            ) : (
              <div className={`text-center ${state === 'bald' ? 'text-base font-bold text-amber-800' : 'text-sm text-gray-700'}`}>
                {state === 'bald' ? 'Achtung: ' : ''}noch {fmt0(limit - pct)} % ≈ {fmt0(leftToLimitM2 / 100)} a ≈ {fmt0(leftToLimitM2 / widthM)} m Fahrt bis zur Grenze
              </div>
            ))}
          <GridCanvas grid={grid} version={version} at={last} />
          <p className="text-[11px] text-gray-500">
            Grün gemäht, gelb steht noch (Spur × {widthM.toLocaleString('de-CH')} m Arbeitsbreite; scharfe Wendebögen zählen nicht). Handy-GPS ist auf
            ±3–5 m genau — ein Puffer von einigen Prozent ist sinnvoll.
          </p>
        </>
      )}
    </section>
  )
}
