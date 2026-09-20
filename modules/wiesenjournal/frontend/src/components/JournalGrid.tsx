import type { DailyFarmLog, FertilizationEntry, Parcel, UsageEntry } from '../types'

const CELL_WIDTH = 34
const LABEL_COL_WIDTH = 200
const ROW_HEIGHT = 44
const FARM_ROW_HEIGHT = 26

export interface DayIndex<T> {
  [parcelId: string]: { [date: string]: T[] }
}

function usageBadge(entries: UsageEntry[]): string | null {
  const e = entries[0]
  if (!e) return null
  if (e.usage_type === 'eingrasen') return '/'
  if (e.usage_type === 'weide_anzahl') return `×${e.animal_count ?? ''}`
  return 'X'
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
          <div key={p.id} className="flex border-b">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-white p-2 text-xs font-medium text-gray-800"
              style={{ width: LABEL_COL_WIDTH, height: ROW_HEIGHT }}
            >
              <span className="min-w-0 flex-1 truncate" title={p.name}>
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
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onCellClick(p, d)}
                    className="flex shrink-0 flex-col items-center justify-center border-l border-gray-100 hover:bg-brand-50"
                    style={{ width: CELL_WIDTH, height: ROW_HEIGHT }}
                  >
                    {badge && <span className="text-[11px] font-bold text-brand-700">{badge}</span>}
                    {fert.length > 0 && (
                      <span className="mt-0.5 flex gap-0.5">
                        {fert.slice(0, 3).map((f) => (
                          <span key={f.id} className="h-1.5 w-1.5 rounded-full bg-amber-600" title={f.duengung_code} />
                        ))}
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
                  if (row.key === 'laufhof_kuehe' || row.key === 'laufhof_rinder') content = v ? '✓' : null
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
