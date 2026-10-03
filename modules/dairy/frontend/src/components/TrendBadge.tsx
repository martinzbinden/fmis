import { levelSeries, TREND_ARROW, type LactationTrend } from '../lib/lactationTrend'

const STYLE = {
  steigend: 'bg-green-100 text-green-800',
  stabil: 'bg-gray-100 text-gray-700',
  fallend: 'bg-red-100 text-red-800',
} as const

/** Tendenz über die Laktationen als kleine Marke: Pfeil, Punkte je
 * Laktation, ggf. "seit n Lakt."; die Niveaus stehen im Tooltip. */
export default function TrendBadge({ trend, compact = false }: { trend: LactationTrend | undefined; compact?: boolean }) {
  if (!trend?.direction || trend.slope == null) return null
  const pts = Math.round(trend.slope * 100)
  return (
    <span
      title={`Niveau je Laktation im Herdenvergleich: ${levelSeries(trend, 5)} — Tendenz über die letzten bis 3 Laktationen ${pts > 0 ? '+' : ''}${pts} Punkte je Laktation`}
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${STYLE[trend.direction]}`}
    >
      {TREND_ARROW[trend.direction]} {compact ? '' : `${trend.direction} `}
      {pts > 0 ? '+' : ''}
      {pts}/Lakt.
      {trend.fallingStreak >= 2 ? ` · fällt seit ${trend.fallingStreak}` : ''}
    </span>
  )
}
