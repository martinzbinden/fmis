import type { LactationLevel } from '../lib/lactationTrend'

/** Mini-Diagramm: Leistungsniveau je Laktation gegen die Herde (gestrichelte Linie = Herdenmittel 100 %).
 * Die laufende Laktation ist heller mit Rand, Niveaus unter 80 % sind rot. */
export default function LactationSpark({ levels }: { levels: LactationLevel[] }) {
  if (levels.length === 0) return null
  const shown = levels.slice(-6)
  const MAX = 1.5
  const W = 14
  const GAP = 4
  const H = 36
  const width = shown.length * (W + GAP) - GAP
  const y = (v: number) => H - Math.max(2, (Math.min(v, MAX) / MAX) * H)
  const title = shown.map((l) => `${l.lactation_number}. Laktation: ${Math.round(l.level * 100)} % der Herde${l.running ? ' (läuft)' : ''}`).join('\n')
  return (
    <svg role="img" aria-label={`Leistung je Laktation. ${title.replace(/\n/g, '; ')}`} width={width} height={H + 12} viewBox={`0 0 ${width} ${H + 12}`} className="shrink-0">
      <title>{title}</title>
      <line x1={0} x2={width} y1={y(1)} y2={y(1)} stroke="currentColor" strokeDasharray="2 2" className="text-gray-400" />
      {shown.map((l, i) => {
        const x = i * (W + GAP)
        const low = l.level < 0.8
        return (
          <g key={l.lactation_number}>
            <rect
              x={x}
              y={y(l.level)}
              width={W}
              height={H - y(l.level)}
              rx={2}
              className={l.running ? (low ? 'fill-red-200 stroke-red-600' : 'fill-gray-200 stroke-gray-500') : low ? 'fill-red-600' : 'fill-gray-600'}
              strokeWidth={l.running ? 1.5 : 0}
              strokeDasharray={l.running ? '3 2' : undefined}
            />
            <text x={x + W / 2} y={H + 10} textAnchor="middle" fontSize={9} className="fill-gray-600">
              {l.lactation_number}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
