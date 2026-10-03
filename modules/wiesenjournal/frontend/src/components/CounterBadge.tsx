import type { MonthCounter } from '../lib/outdoorAccess'

const COUNTER_STYLE: Record<MonthCounter['state'], string> = {
  erfuellt: 'bg-emerald-100 text-emerald-800',
  offen: 'bg-gray-100 text-gray-700',
  knapp: 'bg-amber-100 text-amber-900',
  verfehlt: 'bg-red-100 text-red-800',
}
const COUNTER_TEXT: Record<MonthCounter['state'], string> = { erfuellt: 'erfüllt', offen: 'offen', knapp: 'knapp', verfehlt: 'nicht mehr erreichbar' }

/** "Nov: 3 von 13 Auslauftagen · knapp" */
export default function CounterBadge({ c, compact = false }: { c: MonthCounter; compact?: boolean }) {
  const month = new Date(`${c.month}-15T12:00:00`).toLocaleDateString('de-CH', { month: 'short' })
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs ${COUNTER_STYLE[c.state]}`}
      title={`RAUS ${c.winter ? 'Winter: Auslauftage (Weide oder Laufhof)' : 'Sommer: Weidetage'} — ${c.weide} Weide, ${c.laufhof} Laufhof; Vorgabe anteilig auf ${c.present} Tage mit Tieren bis heute${c.possible ? `, noch ${c.possible} ${c.possible === 1 ? 'Tag' : 'Tage'} möglich` : ''}`}
    >
      {compact ? `${c.done}/${c.target}` : `${month}: ${c.done} von ${c.target} ${c.winter ? 'Auslauftagen' : 'Weidetagen'} · ${COUNTER_TEXT[c.state]}`}
    </span>
  )
}

