import { useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
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
  const ordered = [...curves].sort((a, b) => b.lactation_number - a.lactation_number)
  const bandData = rel
    ? relBand.filter((b) => Number.isFinite(b.median)).map((b) => ({ dim: b.mid, range: [b.q1 * 100, b.q3 * 100] as [number, number], median: 100 }))
    : band.filter((b) => Number.isFinite(b.median)).map((b) => ({ dim: b.mid, range: [b.q1, b.q3] as [number, number], median: b.median }))
  const lineData = (c: LactationCurve) => c.points.map((p) => ({ dim: p.dim, value: rel ? p.rel * 100 : p.value, excluded: p.excluded }))
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
            <Tooltip
              formatter={(v, name) =>
                Array.isArray(v) ? [`${Number(v[0]).toFixed(2)}–${Number(v[1]).toFixed(2)}`, name] : [Number(v).toFixed(2), name]
              }
              labelFormatter={(d) => `Tag ${d}`}
            />
            <Area data={bandData} dataKey="range" name="Herde mittlere Hälfte" stroke="none" fill="#e5e7eb" isAnimationActive={false} />
            <Line data={bandData} dataKey="median" name="Herde Median" stroke="#9ca3af" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
            {ordered.map((c, i) => (
              <Line
                key={c.lactation_number}
                data={lineData(c)}
                dataKey="value"
                name={`${c.lactation_number}. Laktation${c.lactation_number === runningNumber ? ' (laufend)' : ''}`}
                stroke={i === 0 ? '#0f766e' : LINE_GREYS[Math.min(i - 1, LINE_GREYS.length - 1)]}
                strokeWidth={i === 0 ? 2.5 : 1.3}
                dot={dotFor(i === 0 ? '#0f766e' : LINE_GREYS[Math.min(i - 1, LINE_GREYS.length - 1)], i === 0 ? 3 : 2)}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="px-2 text-xs text-gray-500">
        {rel
          ? `Jede Wägung in % der Herde: verglichen mit den Herdengenossinnen am gleichen Wägungstag und bereinigt um Laktationstag und Alter (${PARITY_GROUP_LABEL[group]}) — Jahr, Saison und Futter fallen so heraus. Grau: mittlere Hälfte der Herde, gestrichelt 100 %.`
          : `${unit(metric)} je Wägung. Grau: mittlere Hälfte der Herde (${PARITY_GROUP_LABEL[group]}${year ? `, Jahrgang ${year}` : ''}), gestrichelt der Median.`}{' '}
        Grün: neueste Laktation, grau abgestuft die früheren. Hohle Punkte zählen nicht für die Bewertung.
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
