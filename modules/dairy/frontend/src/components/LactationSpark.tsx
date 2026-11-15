import type { LactationLevel } from '../lib/lactationTrend'
import type { SccLevel } from '../lib/herdContext'

const fmtScc = (t: number) => `${Math.round(t * 1000).toLocaleString('de-CH')}`

// Zellzahl-Skala der roten Linie: logarithmisch 50'000 … 2 Mio. (wie die Zellzahl meist streut)
const SCC_MIN = 50
const SCC_MAX = 2000

/** Mini-Diagramm: Leistungsniveau je Laktation gegen die Herde (Säulen, gestrichelte Linie = Herdenmittel 100 %)
 * und, falls bekannt, die mittlere Zellzahl je Laktation als rote Linie (eigene, logarithmische Skala: höher =
 * mehr Zellen). Die laufende Laktation ist heller mit Rand, Niveaus unter 80 % sind orange. */
export default function LactationSpark({ levels, scc = [] }: { levels: LactationLevel[]; scc?: SccLevel[] }) {
  const numbers = [...new Set([...levels.map((l) => l.lactation_number), ...scc.map((s) => s.lactation_number)])].sort((a, b) => a - b).slice(-6)
  if (numbers.length === 0) return null
  const levelOf = new Map(levels.map((l) => [l.lactation_number, l]))
  const sccOf = new Map(scc.map((s) => [s.lactation_number, s]))
  const MAX = 1.5
  const W = 14
  const GAP = 4
  const H = 36
  const width = numbers.length * (W + GAP) - GAP
  const y = (v: number) => H - Math.max(2, (Math.min(v, MAX) / MAX) * H)
  const ySccRaw = (t: number) => {
    const r = (Math.log(Math.min(Math.max(t, SCC_MIN), SCC_MAX)) - Math.log(SCC_MIN)) / (Math.log(SCC_MAX) - Math.log(SCC_MIN))
    return H - 2 - r * (H - 4)
  }
  const sccPoints = numbers.flatMap((nr, i) => {
    const s = sccOf.get(nr)
    return s ? [{ x: i * (W + GAP) + W / 2, y: ySccRaw(s.scc), s }] : []
  })
  const title = numbers
    .map((nr) => {
      const l = levelOf.get(nr)
      const s = sccOf.get(nr)
      const parts = [l ? `${Math.round(l.level * 100)} % der Herde${l.running ? ' (läuft)' : ''}` : null, s ? `Zellzahl Ø ${fmtScc(s.scc)} (${s.tests} Proben)` : null].filter(Boolean)
      return `${nr}. Laktation: ${parts.join(', ')}`
    })
    .join('\n')
  return (
    <svg role="img" aria-label={`Leistung und Zellzahl je Laktation. ${title.replace(/\n/g, '; ')}`} width={width} height={H + 12} viewBox={`0 0 ${width} ${H + 12}`} className="shrink-0 overflow-visible">
      <title>{title}</title>
      <line x1={0} x2={width} y1={y(1)} y2={y(1)} stroke="currentColor" strokeDasharray="2 2" className="text-gray-400" />
      {numbers.map((nr, i) => {
        const x = i * (W + GAP)
        const l = levelOf.get(nr)
        const low = l ? l.level < 0.8 : false
        return (
          <g key={nr}>
            {l && (
              <rect
                x={x}
                y={y(l.level)}
                width={W}
                height={H - y(l.level)}
                rx={2}
                className={l.running ? (low ? 'fill-orange-200 stroke-orange-600' : 'fill-gray-200 stroke-gray-500') : low ? 'fill-orange-500' : 'fill-gray-600'}
                strokeWidth={l.running ? 1.5 : 0}
                strokeDasharray={l.running ? '3 2' : undefined}
              />
            )}
            <text x={x + W / 2} y={H + 10} textAnchor="middle" fontSize={9} className="fill-gray-600">
              {nr}
            </text>
          </g>
        )
      })}
      {sccPoints.length > 1 && (
        <polyline points={sccPoints.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#dc2626" strokeWidth={1.5} strokeLinejoin="round" />
      )}
      {sccPoints.map((p) => (
        <circle key={p.s.lactation_number} cx={p.x} cy={p.y} r={2.2} fill="#dc2626" stroke="white" strokeWidth={0.8} />
      ))}
    </svg>
  )
}
