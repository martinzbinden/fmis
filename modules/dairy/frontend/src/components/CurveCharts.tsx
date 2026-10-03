import { useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  usePlotArea,
  useXAxisInverseScale,
} from 'recharts'
import { meanOf, smoothAt, type Estimate } from '../lib/curveExplorer'
import type { SnapshotPoint, SnapshotPosition } from '../lib/herdSnapshot'
import {
  BLOCK_DAYS,
  CURVE_CLASS_LABEL,
  LAST_BLOCK,
  PARITY_GROUP_LABEL,
  type BandBlock,
  type CurveClass,
  type CurveMetric,
  type LactationCurve,
  type ParityGroup,
} from '../lib/lactationCurves'

export const CLASS_COLOR: Record<CurveClass, string> = {
  hoch_ausdauernd: '#15803d',
  hoch_abfallend: '#ca8a04',
  tief_ausdauernd: '#2563eb',
  tief_abfallend: '#dc2626',
}

const MAX_X = (LAST_BLOCK + 1) * BLOCK_DAYS
const unit = (metric: CurveMetric) => (metric === 'fe' ? 'kg F+E' : 'kg Milch')

/** Kleine Kurve für die Tierzeile, im Herdenvergleich: Linie = Wägungen in
 * % der Herde (Testtag-bereinigt), grau die mittlere Hälfte der Herde,
 * gestrichelt 100 %. Hoch = gutes Niveau, steigend/flach = ausdauernd. */
export function MiniCurve({ curve, band, color = '#334155' }: { curve: LactationCurve; band: BandBlock[]; color?: string }) {
  const W = 96
  const H = 34
  const finite = band.filter((b) => Number.isFinite(b.q3))
  const vals = curve.points.map((p) => p.rel)
  const maxY = Math.max(1.6, ...vals, ...finite.map((b) => b.q3)) * 1.02
  const minY = Math.min(0.4, ...vals, ...finite.map((b) => b.q1)) * 0.98
  const x = (d: number) => (Math.min(d, MAX_X) / MAX_X) * W
  const y = (v: number) => H - ((v - minY) / (maxY - minY)) * H
  const upper = finite.map((b) => `${x(b.mid)},${y(b.q3)}`)
  const lower = [...finite].reverse().map((b) => `${x(b.mid)},${y(b.q1)}`)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" aria-hidden>
      {finite.length > 1 && <polygon points={[...upper, ...lower].join(' ')} fill="#e5e7eb" />}
      {finite.length > 1 && (
        <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="#9ca3af" strokeWidth="1" strokeDasharray="2 2" />
      )}
      <polyline points={curve.points.map((p) => `${x(p.dim)},${y(p.rel)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.8" />
      {curve.points.map((p) => (
        <circle
          key={p.test_date}
          cx={x(p.dim)}
          cy={y(p.rel)}
          r="1.6"
          fill={p.excluded ? 'white' : color}
          stroke={color}
          strokeWidth={p.excluded ? 0.8 : 0}
          opacity={p.excluded ? 0.6 : 1}
        />
      ))}
    </svg>
  )
}

const LINE_GREYS = ['#475569', '#64748b', '#94a3b8', '#cbd5e1']
const NEWEST_COLOR = '#0f766e'
const lineColor = (i: number) => (i === 0 ? NEWEST_COLOR : LINE_GREYS[Math.min(i - 1, LINE_GREYS.length - 1)])

/** Unsichtbare Fläche über dem Diagramm: Maus/Finger → Laktationstag. Liegt
 * zuoberst; senkrechtes Wischen scrollt die Seite weiter (touch-action). */
function HoverCapture({ onDay }: { onDay: (day: number | null) => void }) {
  const area = usePlotArea()
  const invert = useXAxisInverseScale()
  if (!area || !invert) return null
  const move = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement
    if (!svg) return
    const day = Number(invert(e.clientX - svg.getBoundingClientRect().left))
    if (Number.isFinite(day)) onDay(Math.max(0, Math.min(MAX_X, Math.round(day))))
  }
  return (
    <rect
      x={area.x}
      y={area.y}
      width={area.width}
      height={area.height}
      fill="transparent"
      style={{ touchAction: 'pan-y', cursor: 'crosshair' }}
      onPointerMove={move}
      onPointerDown={move}
    />
  )
}

/** Alle Laktationen eines Tiers übereinander, vor dem Herdenband seiner
 * aktuellen Laktationsgruppe. Neueste Laktation kräftig, ältere grau. */
export function LactationCurveChart({
  curves,
  band,
  group,
  metric,
  runningNumber,
  year,
  relBand,
}: {
  curves: LactationCurve[]
  band: BandBlock[]
  relBand: BandBlock[]
  group: ParityGroup
  metric: CurveMetric
  runningNumber: number | null
  year: string | null
}) {
  // "% der Herde": jede Laktation im Vergleich zu ihrem eigenen Jahrgang —
  // so sind Laktationen verschiedener Jahre direkt vergleichbar.
  const [mode, setMode] = useState<'rel' | 'abs'>('rel')
  const rel = mode === 'rel'
  // Datenexplorer: Laktationstag unter Maus/Finger; bleibt stehen, wenn man
  // die Grafik verlässt (am Handy sonst gleich wieder weg)
  const [cursor, setCursor] = useState<number | null>(null)
  const ordered = [...curves].sort((a, b) => b.lactation_number - a.lactation_number)
  const bandData = rel
    ? relBand.filter((b) => Number.isFinite(b.median)).map((b) => ({ dim: b.mid, range: [b.q1 * 100, b.q3 * 100] as [number, number], median: 100 }))
    : band.filter((b) => Number.isFinite(b.median)).map((b) => ({ dim: b.mid, range: [b.q1, b.q3] as [number, number], median: b.median }))
  const lineData = (c: LactationCurve) => c.points.map((p) => ({ dim: p.dim, value: rel ? p.rel * 100 : p.value, excluded: p.excluded }))
  const fmt = (v: number) => (rel ? `${Math.round(v)} %` : `${v.toFixed(metric === 'fe' ? 2 : 1)} kg`)
  const estimates: { c: LactationCurve; color: string; est: Estimate | null }[] =
    cursor == null
      ? []
      : ordered.map((c, i) => ({ c, color: lineColor(i), est: smoothAt(lineData(c).map((p) => ({ dim: p.dim, value: p.value })), cursor) }))
  const herdAt = cursor == null ? undefined : bandData.reduce<(typeof bandData)[number] | undefined>((best, b) => (!best || Math.abs(b.dim - cursor) < Math.abs(best.dim - cursor) ? b : best), undefined)
  const newest = estimates[0]?.est?.value ?? null
  const earlier = meanOf(estimates.slice(1).map((e) => e.est?.value))
  // Weggelassene Wägungen hohl zeichnen
  const dotFor = (color: string, r: number) => (props: { cx?: number; cy?: number; payload?: { excluded?: boolean }; index?: number }) => (
    <circle
      key={props.index}
      cx={props.cx}
      cy={props.cy}
      r={r}
      fill={props.payload?.excluded ? 'white' : color}
      stroke={color}
      strokeWidth={props.payload?.excluded ? 1.2 : 0}
      opacity={props.payload?.excluded ? 0.7 : 1}
    />
  )
  return (
    <div>
      <div className="flex justify-end gap-1 px-2 pt-2 text-xs">
        {(
          [
            ['rel', '% der Herde'],
            ['abs', unit(metric)],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded px-2 py-0.5 ${mode === m ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="dim"
              type="number"
              domain={[0, MAX_X]}
              ticks={[0, 60, 120, 180, 240, 300]}
              tick={{ fontSize: 11 }}
              label={{ value: 'Tage nach Geburt', position: 'insideBottomRight', offset: -2, fontSize: 10 }}
            />
            <YAxis tick={{ fontSize: 11 }} width={44} />
            <Area data={bandData} dataKey="range" name="Herde mittlere Hälfte" stroke="none" fill="#e5e7eb" isAnimationActive={false} />
            <Line data={bandData} dataKey="median" name="Herde Median" stroke="#9ca3af" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            {ordered.map((c, i) => (
              <Line
                key={c.lactation_number}
                data={lineData(c)}
                dataKey="value"
                name={`${c.lactation_number}. Laktation${c.lactation_number === runningNumber ? ' (laufend)' : ''}`}
                stroke={lineColor(i)}
                strokeWidth={i === 0 ? 2.5 : 1.3}
                dot={dotFor(lineColor(i), i === 0 ? 3 : 2)}
                isAnimationActive={false}
              />
            ))}
            {cursor != null && <ReferenceLine x={cursor} stroke="#0f172a" strokeOpacity={0.35} />}
            {estimates.map(({ c, color, est }) =>
              est ? <ReferenceDot key={c.lactation_number} x={cursor!} y={est.value} r={4.5} fill={color} stroke="white" strokeWidth={1.5} /> : null,
            )}
            <HoverCapture onDay={setCursor} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mx-2 min-h-[4.5rem] rounded bg-gray-50 px-2 py-1.5 text-xs">
        {cursor == null ? (
          <p className="pt-3 text-center text-gray-400">Über die Grafik fahren oder tippen: alle Laktationen am selben Laktationstag vergleichen.</p>
        ) : (
          <>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold text-gray-700">Tag {cursor}</span>
              {herdAt && (
                <span className="text-gray-500">
                  Herde: {rel ? '100 %' : fmt(herdAt.median)} · mittlere Hälfte {fmt(herdAt.range[0])}–{fmt(herdAt.range[1])}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
              {estimates.map(({ c, color, est }) => (
                <span key={c.lactation_number} className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                  <span className="text-gray-600">
                    {c.lactation_number}.{c.lactation_number === runningNumber ? ' (lfd.)' : ''}
                  </span>
                  <span className={est ? 'font-semibold text-gray-800' : 'text-gray-300'}>{est ? fmt(est.value) : '—'}</span>
                  {est && !est.measured && <span className="text-gray-400">≈</span>}
                </span>
              ))}
            </div>
            {newest != null && earlier != null && (
              <p className="mt-1 text-gray-500">
                Neueste gegenüber Mittel der früheren:{' '}
                <b className={newest >= earlier ? 'text-emerald-700' : 'text-red-700'}>
                  {rel ? `${newest - earlier >= 0 ? '+' : ''}${Math.round(newest - earlier)} Prozentpunkte` : `${newest - earlier >= 0 ? '+' : ''}${(newest - earlier).toFixed(metric === 'fe' ? 2 : 1)} kg`}
                </b>
              </p>
            )}
          </>
        )}
      </div>
      <p className="px-2 text-xs text-gray-500">
        {rel
          ? `Jede Wägung in % der Herde: verglichen mit den Herdengenossinnen am gleichen Wägungstag und bereinigt um Laktationstag und Alter (${PARITY_GROUP_LABEL[group]}) — Jahr, Saison und Futter fallen so heraus. Grau: mittlere Hälfte der Herde, gestrichelt 100 %.`
          : `${unit(metric)} je Wägung. Grau: mittlere Hälfte der Herde (${PARITY_GROUP_LABEL[group]}${year ? `, Jahrgang ${year}` : ''}), gestrichelt der Median.`}{' '}
        Grün: neueste Laktation, grau abgestuft die früheren. Hohle Punkte zählen nicht für die Bewertung. Im Explorer: ≈ = geglättet aus den
        umliegenden Wägungen, sonst Wägung innert 3 Tagen; — = an diesem Tag nicht gewogen (vor der ersten oder nach der letzten Wägung).
      </p>
    </div>
  )
}

export interface ScatterPoint {
  animal_id: string
  label: string
  lactation_number: number
  running: boolean
  level: number
  persistence: number
  klass: CurveClass
}

/** Herdenbild: jedes Tier ein Punkt (bewertete Laktation), Niveau ×
 * Persistenz, Quadranten = Klassen. */
export function HerdScatter({ points, onSelect }: { points: ScatterPoint[]; onSelect: (animalId: string) => void }) {
  const data = points.map((p) => ({ ...p, x: Math.round(p.level * 100), y: Math.round(p.persistence * 100), yRaw: Math.round(p.persistence * 100) }))
  const xs = data.map((d) => d.x)
  const ys = data.map((d) => d.y)
  const xMin = Math.floor((Math.min(60, ...xs) - 5) / 20) * 20
  const xMax = Math.ceil((Math.max(140, ...xs) + 5) / 20) * 20
  // Ausreisser (wenige Wägungen) nicht die ganze Skala bestimmen lassen.
  const yLim = Math.min(80, Math.ceil((Math.max(30, ...ys.map(Math.abs)) + 5) / 20) * 20)
  const xTicks = Array.from({ length: (xMax - xMin) / 20 + 1 }, (_, i) => xMin + i * 20)
  const shown = data.map((d) => ({ ...d, y: Math.max(-yLim, Math.min(yLim, d.y)) }))
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 10, bottom: 18, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <ReferenceArea x1={100} x2={xMax} y1={0} y2={yLim} fill="#dcfce7" fillOpacity={0.5} />
          <ReferenceArea x1={xMin} x2={100} y1={-yLim} y2={0} fill="#fee2e2" fillOpacity={0.5} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[xMin, xMax]}
            ticks={xTicks}
            tick={{ fontSize: 11 }}
            label={{ value: 'Niveau % der Herde', position: 'insideBottom', offset: -10, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[-yLim, yLim]}
            tick={{ fontSize: 11 }}
            width={40}
            label={{ value: 'Persistenz', angle: -90, position: 'insideLeft', offset: 14, fontSize: 10 }}
          />
          <ZAxis range={[46, 46]} />
          <ReferenceLine x={100} stroke="#9ca3af" />
          <ReferenceLine y={0} stroke="#9ca3af" />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as (ScatterPoint & { x: number; y: number; yRaw: number }) | undefined
              if (!p) return null
              return (
                <div className="rounded border bg-white px-2 py-1 text-xs shadow">
                  <div className="font-semibold">{p.label}</div>
                  <div>
                    {p.lactation_number}. Laktation{p.running ? ' (laufend)' : ''}
                  </div>
                  <div>
                    Niveau {p.x} % · Persistenz {p.yRaw > 0 ? '+' : ''}
                    {p.yRaw} %-P./100 T.
                  </div>
                  <div style={{ color: CLASS_COLOR[p.klass] }}>{CURVE_CLASS_LABEL[p.klass]}</div>
                </div>
              )
            }}
          />
          {(Object.keys(CLASS_COLOR) as CurveClass[]).map((k) => (
            <Scatter
              key={k}
              data={shown.filter((d) => d.klass === k)}
              fill={CLASS_COLOR[k]}
              isAnimationActive={false}
              onClick={(d: unknown) => onSelect((d as { payload?: ScatterPoint }).payload?.animal_id ?? (d as ScatterPoint).animal_id)}
              className="cursor-pointer"
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

export const POSITION_COLOR: Record<Exclude<SnapshotPosition, null> | 'none', string> = {
  hoch: '#15803d',
  mitte: '#64748b',
  tief: '#dc2626',
  none: '#cbd5e1',
}
export const POSITION_LABEL: Record<Exclude<SnapshotPosition, null>, string> = {
  hoch: 'über der mittleren Hälfte',
  mitte: 'in der mittleren Hälfte',
  tief: 'unter der mittleren Hälfte',
}

export type DimPoint = SnapshotPoint & { label: string }

/** Herdenbild Milch × Laktationstag: alle Tiere eines Wägungstags an ihrem
 * Laktationstag, vor der Herdenkurve (grau ab 2. Laktation, gestrichelt
 * Median Erstlinge). Farbe = Lage zur eigenen Gruppe, hohl = Erstling. */
export function HerdDimChart({
  points,
  bandOlder,
  bandFirst,
  unitLabel,
  decimals,
  onSelect,
}: {
  points: DimPoint[]
  bandOlder: BandBlock[]
  bandFirst: BandBlock[]
  unitLabel: string
  decimals: number
  onSelect: (animalId: string) => void
}) {
  const older = bandOlder.filter((b) => Number.isFinite(b.median)).map((b) => ({ dim: b.mid, range: [b.q1, b.q3] as [number, number], median: b.median }))
  const first = bandFirst.filter((b) => Number.isFinite(b.median)).map((b) => ({ dim: b.mid, firstMedian: b.median }))
  const xMax = Math.max(MAX_X, Math.ceil((Math.max(0, ...points.map((p) => p.dim)) + 10) / 60) * 60)
  const ticks = Array.from({ length: xMax / 60 + 1 }, (_, i) => i * 60)
  const fmt = (v: number) => v.toFixed(decimals)
  const shape = (props: { cx?: number; cy?: number; payload?: DimPoint }) => {
    const p = props.payload
    if (!p || props.cx == null || props.cy == null) return <g />
    const color = POSITION_COLOR[p.position ?? 'none']
    const firstLact = p.group === 1
    return (
      <circle
        cx={props.cx}
        cy={props.cy}
        r={5}
        fill={firstLact ? 'white' : color}
        stroke={color}
        strokeWidth={firstLact ? 2 : 1}
        style={{ cursor: 'pointer' }}
      />
    )
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 10, right: 10, bottom: 18, left: -6 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            type="number"
            dataKey="dim"
            domain={[0, xMax]}
            ticks={ticks}
            tick={{ fontSize: 11 }}
            label={{ value: 'Laktationstag', position: 'insideBottom', offset: -10, fontSize: 10 }}
          />
          <YAxis
            type="number"
            tick={{ fontSize: 11 }}
            width={44}
            label={{ value: unitLabel, angle: -90, position: 'insideLeft', offset: 14, fontSize: 10 }}
          />
          <Area data={older} dataKey="range" name="Herde ab 2. Laktation, mittlere Hälfte" stroke="none" fill="#e5e7eb" isAnimationActive={false} />
          <Line data={older} dataKey="median" name="Median ab 2. Laktation" stroke="#9ca3af" dot={false} isAnimationActive={false} />
          <Line data={first} dataKey="firstMedian" name="Median Erstlinge" stroke="#9ca3af" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Scatter
            data={points}
            dataKey="value"
            shape={shape}
            isAnimationActive={false}
            onClick={(d: { payload?: DimPoint }) => d?.payload?.animal_id && onSelect(d.payload.animal_id)}
          />
          <Tooltip
            // je Punkt statt je x-Stelle (sonst rastet er an den Herdenlinien ein)
            shared={false}
            cursor={false}
            content={({ payload }) => {
              const p = payload?.map((x) => x.payload as DimPoint | undefined).find((x) => x?.animal_id)
              if (!p) return null
              return (
                <div className="rounded border bg-white px-2 py-1 text-xs shadow">
                  <div className="font-semibold">{p.label}</div>
                  <div>
                    {p.lactation_number}. Laktation · Tag {p.dim}
                  </div>
                  <div>
                    {fmt(p.value)} {unitLabel}
                    {p.herdMedian != null ? ` · Herde ${fmt(p.herdMedian)}` : ''}
                  </div>
                  {p.position && <div style={{ color: POSITION_COLOR[p.position] }}>{POSITION_LABEL[p.position]}</div>}
                </div>
              )
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
