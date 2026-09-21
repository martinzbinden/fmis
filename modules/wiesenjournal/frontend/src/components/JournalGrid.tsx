import type { DailyFarmLog, FertilizationEntry, Parcel, UsageEntry } from '../types'
import { PARCEL_CATEGORY_COLOR, usageDescription, usageLegend } from '../lib/format'

const CELL_WIDTH = 34
const LABEL_COL_WIDTH = 220
const ROW_HEIGHT = 46
const FARM_ROW_HEIGHT = 26

export interface DayIndex<T> {
  [parcelId: string]: { [date: string]: T[] }
}

// Obere Zeile der Zelle: Legenden-Buchstaben aller Nutzungen des Tages
// (wie im Papierjournal, z.B. "XW" = Kühe und Schafe, "x" = Tagweide Kühe).
function usageBadge(entries: UsageEntry[]): string | null {
  if (entries.length === 0) return null
  return entries.map(usageLegend).join('')
}

// Kürzel des Betriebs vor dem Parzellennamen (zwei Betriebe, eine Liste).
function farmPrefix(p: Parcel): string {
  return p.farm_name ? p.farm_name.slice(0, 1).toUpperCase() + ' · ' : ''
}

function shortDay(iso: string): { dow: string; dom: string; isFirstOfMonth: boolean } {
  const d = new Date(iso + 'T00:00:00')
  return {
    dow: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()],
    dom: String(d.getDate()),
    isFirstOfMonth: d.getDate() === 1,
  }
}

function monthLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('de-CH', { month: 'short' })
}

interface Props {
  parcels: Parcel[]
  days: string[]
  usageByDay: DayIndex<UsageEntry>
  fertByDay: DayIndex<FertilizationEntry>
  dailyLogByDate: Record<string, DailyFarmLog>
  onCellClick: (parcel: Parcel, date: string) => void
  onFarmCellClick: (date: string) => void
  onGabenClick: (parcel: Parcel) => void
  onFocusMap: (parcel: Parcel) => void
}

export default function JournalGrid({
  parcels,
  days,
  usageByDay,
  fertByDay,
  dailyLogByDate,
  onCellClick,
  onFarmCellClick,
  onGabenClick,
  onFocusMap,
}: Props) {
  const trackWidth = days.length * CELL_WIDTH

  return (
    <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
      <div style={{ minWidth: LABEL_COL_WIDTH + trackWidth }}>
        {/* Monats-/Tages-Header */}
        <div className="flex border-b">
          <div className="sticky left-0 z-20 shrink-0 bg-white p-2 text-xs font-medium text-gray-500" style={{ width: LABEL_COL_WIDTH }}>
            Parzelle
          </div>
          <div className="flex">
            {days.map((d) => {
              const { dow, dom, isFirstOfMonth } = shortDay(d)
              return (
                <div
                  key={d}
                  className="shrink-0 border-l border-gray-100 pt-1 text-center text-[9px] leading-tight text-gray-400"
                  style={{ width: CELL_WIDTH }}
                >
                  {isFirstOfMonth && <div className="font-semibold text-gray-600">{monthLabel(d)}</div>}
                  <div>{dow}</div>
                  <div>{dom}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Parzellen-Zeilen */}
        {parcels.map((p) => (
          <div key={p.id} className={`flex border-b ${p.category === 'acker' ? 'bg-amber-50/40' : ''}`}>
            <div
              className={`sticky left-0 z-10 flex shrink-0 items-center gap-1 p-2 text-xs font-medium text-gray-800 ${
                p.category === 'acker' ? 'bg-amber-50' : 'bg-white'
              }`}
              style={{ width: LABEL_COL_WIDTH, height: ROW_HEIGHT }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: PARCEL_CATEGORY_COLOR[p.category] ?? '#6b7280' }}
                title={p.kultur_name_de ?? p.category}
              />
              <span className="min-w-0 flex-1 truncate" title={`${p.name}${p.kultur_name_de ? ' · ' + p.kultur_name_de : ''}`}>
                <span className="text-gray-400">{farmPrefix(p)}</span>
                {p.name}
              </span>
              <button
                type="button"
                onClick={() => onFocusMap(p)}
                title="Auf Karte zeigen"
                aria-label="Auf Karte zeigen"
                className="rounded p-1 text-sm leading-none active:bg-gray-100"
              >
                🌐
              </button>
              <button
                type="button"
                onClick={() => onGabenClick(p)}
                title="Gaben (Stickstoff)"
                aria-label="Gaben"
                className="rounded p-1 text-sm leading-none text-gray-500 active:bg-gray-100"
              >
                ☰
              </button>
            </div>
            <div className="flex">
              {days.map((d) => {
                const usage = usageByDay[p.id]?.[d] ?? []
                const fert = fertByDay[p.id]?.[d] ?? []
                const badge = usageBadge(usage)
                const title = [
                  ...usage.map(usageDescription),
                  ...fert.map((f) => `${f.duengung_code}${f.amount != null ? ` ${f.amount} ${f.unit}` : ''}`),
                ].join('\n')
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onCellClick(p, d)}
                    title={title || undefined}
                    className="flex shrink-0 flex-col items-center justify-center overflow-hidden border-l border-gray-100 hover:bg-brand-50"
                    style={{ width: CELL_WIDTH, height: ROW_HEIGHT }}
                  >
                    {badge && (
                      <span className={`font-bold leading-tight text-brand-700 ${badge.length > 2 ? 'text-[9px]' : 'text-[11px]'}`}>
                        {badge}
                      </span>
                    )}
                    {fert.length > 0 && (
                      <span className="mt-0.5 max-w-full truncate text-[8px] font-semibold leading-tight text-amber-700">
                        {fert.map((f) => f.duengung_code).join(' ')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {/* Betriebsweite Tagesmeldung */}
        {(
          [
            { key: 'laufhof_kuehe', label: 'Laufhof Kühe' },
            { key: 'laufhof_rinder', label: 'Laufhof Rinder' },
            { key: 'laufhof_kaelber', label: 'Laufhof Kälber' },
            { key: 'laufhof_galtkuehe', label: 'Laufhof Galtkühe' },
            { key: 'laufhof_schafe', label: 'Laufhof Schafe' },
            { key: 'laufhof_legehennen', label: 'Laufhof Legehennen' },
            { key: 'wetter_code', label: 'Wetter' },
            { key: 'niederschlag_mm', label: 'Niederschlag' },
            { key: 'mond_phase', label: 'Mond' },
          ] as const
        ).map((row) => (
          <div key={row.key} className="flex border-b bg-gray-50/50">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center bg-gray-50 p-2 text-[11px] font-medium text-gray-600"
              style={{ width: LABEL_COL_WIDTH, height: FARM_ROW_HEIGHT }}
            >
              {row.label}
            </div>
            <div className="flex">
              {days.map((d) => {
                const log = dailyLogByDate[d]
                let content: string | null = null
                if (log) {
                  const v = log[row.key as keyof DailyFarmLog]
                  if (row.key.startsWith('laufhof_')) content = v ? '✓' : null
                  else if (v != null) content = String(v)
                }
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onFarmCellClick(d)}
                    className="shrink-0 border-l border-gray-100 text-center text-[9px] text-gray-600 hover:bg-brand-50"
                    style={{ width: CELL_WIDTH, height: FARM_ROW_HEIGHT }}
                  >
                    {content}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
