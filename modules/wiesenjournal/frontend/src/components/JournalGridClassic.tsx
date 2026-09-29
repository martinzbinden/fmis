import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type { DailyFarmLog, FertilizationEntry, Parcel, UsageEntry } from '../types'
import { USAGE_COLOR, USAGE_COLOR_FAMILY, fmtArea, usageDescription, usageLegend } from '../lib/format'
import { groupUsageRuns, type UsageBar } from '../lib/journalRun'
import type { DayIndex } from './JournalGrid'

const LABEL_COL_WIDTH = 168
const ROW_HEIGHT = 40
const FARM_ROW_HEIGHT = 24

// Stabile leere Objekte statt `?? {}` an der Aufrufstelle — ein frisches `{}`
// bei jedem Rendern würde die memo()-Prüfung von ClassicRow für Parzellen
// ohne Einträge unnötig scheitern lassen (siehe Kommentar bei ClassicRow).
const EMPTY_USAGE: Record<string, UsageEntry[] | undefined> = {}
const EMPTY_FERT: Record<string, FertilizationEntry[] | undefined> = {}

function shortDay(iso: string): { dow: string; dom: string; isFirstOfMonth: boolean } {
  const d = new Date(iso + 'T00:00:00')
  return {
    dow: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()],
    dom: String(d.getDate()),
    isFirstOfMonth: d.getDate() === 1,
  }
}

function isWeekend(iso: string): boolean {
  const dow = new Date(iso + 'T00:00:00').getDay()
  return dow === 0 || dow === 6
}

function monthLabel(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-CH', { month: 'short' })
}

function fertTitle(f: FertilizationEntry): string {
  return `${f.duengung_code}${f.amount != null ? ` ${f.amount} ${f.unit === 'm3' ? 'm³' : f.unit}` : ''}${f.notes ? ` · ${f.notes}` : ''}`
}

// Eine Parzellen-Zeile ist memoized: bei ~90 Parzellen × ~245 Tagen wären
// sonst bei JEDEM Tipp (Zwei-Tipp-Erstellung, siehe unten) alle ~28'000
// Tageszellen neu gerendert worden — spürbar hängend. Mit memo() und einem
// pro Zeile isolierten `armedDate` (statt des ganzen "armed"-Objekts) rendert
// ein Tipp nur die eine betroffene Zeile neu.
const ClassicRow = memo(function ClassicRow({
  parcel,
  days,
  usageByDate,
  fertByDate,
  bars,
  cellWidth,
  trackWidth,
  armedDate,
  onDayClick,
  onFocusMap,
}: {
  parcel: Parcel
  days: string[]
  usageByDate: Record<string, UsageEntry[] | undefined>
  fertByDate: Record<string, FertilizationEntry[] | undefined>
  bars: UsageBar[]
  cellWidth: number
  trackWidth: number
  armedDate: string | null
  onDayClick: (parcel: Parcel, date: string, hasContent: boolean) => void
  onFocusMap: (parcel: Parcel) => void
}) {
  // Welcher Tag-Index gehört zu einem laufenden Balken (nicht sein erster
  // Tag) — dort keinen eigenen Klick-Button zeichnen, der Balken selbst
  // deckt die volle Spanne visuell ab.
  const coveredIdx = new Set<number>()
  for (const b of bars) for (let k = 1; k < b.span; k++) coveredIdx.add(b.startIdx + k)

  return (
    <div className={`flex border-b ${parcel.category === 'acker' ? 'bg-amber-50/40' : ''}`}>
      <div
        className={`sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 p-2 ${
          parcel.category === 'acker' ? 'bg-amber-50' : 'bg-white'
        }`}
        style={{ width: LABEL_COL_WIDTH, height: ROW_HEIGHT }}
      >
        <div className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800" title={parcel.name}>
            {parcel.name}
          </span>
          <button
            type="button"
            onClick={() => onFocusMap(parcel)}
            title="Auf Karte zeigen"
            aria-label="Auf Karte zeigen"
            className="shrink-0 rounded text-xs leading-none active:bg-gray-100"
          >
            🌐
          </button>
        </div>
        <div className="truncate text-[10px] text-gray-400">
          {fmtArea(parcel.area_a)}
          {parcel.kultur_name_de ? ` · ${parcel.kultur_name_de}` : ''}
        </div>
      </div>

      <div className="relative" style={{ width: trackWidth, height: ROW_HEIGHT }}>
        {/* Hintergrund: Wochenenden/Monatsgrenzen + Klick-Buttons */}
        {days.map((d, idx) => {
          if (coveredIdx.has(idx)) return null
          const usage = usageByDate[d] ?? []
          const fert = fertByDate[d] ?? []
          const hasContent = usage.length > 0 || fert.length > 0
          const isArmed = armedDate === d
          const { isFirstOfMonth } = shortDay(d)
          const title = [...usage.map(usageDescription), ...fert.map(fertTitle)].join('\n')
          return (
            <button
              key={d}
              type="button"
              onClick={() => onDayClick(parcel, d, hasContent)}
              title={title || undefined}
              className={`absolute top-0 flex items-center justify-center hover:bg-brand-50 ${
                isFirstOfMonth ? 'border-l-2 border-gray-300' : 'border-l border-gray-100'
              } ${isWeekend(d) ? 'bg-gray-50' : ''}`}
              style={{ left: idx * cellWidth, width: cellWidth, height: ROW_HEIGHT }}
            >
              {isArmed && <span className="text-sm font-bold text-brand-600">+</span>}
            </button>
          )
        })}

        {/* Nutzungs-Balken (Farbe = Vorgang, mehrtägig = durchgehend) */}
        {bars.map((bar) => {
          const family = USAGE_COLOR_FAMILY[bar.entry.usage_type] ?? 'sonstig'
          const color = USAGE_COLOR[family]
          const dayOnly = bar.entry.usage_type === 'weide' && bar.entry.day_only
          const letter = usageLegend(bar.entry)
          const left = bar.startIdx * cellWidth + 2
          const width = bar.span * cellWidth - 4
          return (
            <div
              key={`${bar.entry.id}-${bar.startIdx}`}
              className="pointer-events-none absolute flex items-center justify-center overflow-hidden whitespace-nowrap rounded text-[10px] font-bold"
              style={{
                left,
                width: Math.max(width, 8),
                top: 3,
                height: ROW_HEIGHT - 10,
                background: dayOnly ? `${color}22` : color,
                border: dayOnly ? `1.5px solid ${color}` : 'none',
                color: dayOnly ? color : '#ffffff',
              }}
            >
              {letter}
            </div>
          )
        })}

        {/* Düngung: eigener Streifen unten, unabhängig von der Nutzungsfarbe */}
        {days.map((d, idx) => {
          const fert = fertByDate[d] ?? []
          if (fert.length === 0) return null
          return (
            <div
              key={`fert-${d}`}
              className="pointer-events-none absolute rounded-sm"
              style={{ left: idx * cellWidth + 2, width: cellWidth - 4, bottom: 3, height: 4, background: '#92400e' }}
            />
          )
        })}
      </div>
    </div>
  )
})

interface Props {
  parcels: Parcel[]
  days: string[]
  usageByDay: DayIndex<UsageEntry>
  fertByDay: DayIndex<FertilizationEntry>
  dailyLogByDate: Record<string, DailyFarmLog>
  onDayOpen: (parcel: Parcel, date: string) => void
  onFarmCellClick: (date: string) => void
  onFocusMap: (parcel: Parcel) => void
  cellWidth?: number
  scrollRef?: (node: HTMLDivElement | null) => void
}

export default function JournalGridClassic({
  parcels,
  days,
  usageByDay,
  fertByDay,
  dailyLogByDate,
  onDayOpen,
  onFarmCellClick,
  onFocusMap,
  cellWidth = 28,
  scrollRef,
}: Props) {
  const trackWidth = days.length * cellWidth

  // Für neue Einträge zweimal tippen: erster Tipp "bewaffnet" die leere
  // Zelle (zeigt "+"), zweiter Tipp auf dieselbe Zelle öffnet den Editor —
  // verhindert versehentliche neue Einträge beim Scrollen/Zoomen eines
  // dichten Rasters. Zellen mit bestehendem Inhalt öffnen weiterhin sofort.
  // Ref statt nur State, damit handleDayClick unten stabil bleibt (siehe
  // ClassicRow-Kommentar) und nicht bei jeder Bewaffnung neu gebaut wird.
  const [armed, setArmed] = useState<{ parcelId: string; date: string } | null>(null)
  const armedRef = useRef(armed)
  armedRef.current = armed

  const handleDayClick = useCallback(
    (parcel: Parcel, date: string, hasContent: boolean) => {
      if (hasContent) {
        setArmed(null)
        onDayOpen(parcel, date)
        return
      }
      const a = armedRef.current
      if (a && a.parcelId === parcel.id && a.date === date) {
        setArmed(null)
        onDayOpen(parcel, date)
      } else {
        setArmed({ parcelId: parcel.id, date })
      }
    },
    [onDayOpen],
  )

  const barsByParcel = useMemo(() => {
    const out: Record<string, UsageBar[]> = {}
    for (const p of parcels) out[p.id] = groupUsageRuns(days, usageByDay[p.id] ?? {})
    return out
  }, [parcels, days, usageByDay])

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg bg-white shadow-sm">
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
                  className={`shrink-0 pt-1 text-center text-[8px] leading-tight text-gray-400 ${
                    isFirstOfMonth ? 'border-l-2 border-gray-300' : 'border-l border-gray-100'
                  } ${isWeekend(d) ? 'bg-gray-100' : ''}`}
                  style={{ width: cellWidth }}
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
          <ClassicRow
            key={p.id}
            parcel={p}
            days={days}
            usageByDate={usageByDay[p.id] ?? EMPTY_USAGE}
            fertByDate={fertByDay[p.id] ?? EMPTY_FERT}
            bars={barsByParcel[p.id] ?? []}
            cellWidth={cellWidth}
            trackWidth={trackWidth}
            armedDate={armed?.parcelId === p.id ? armed.date : null}
            onDayClick={handleDayClick}
            onFocusMap={onFocusMap}
          />
        ))}

        {/* Betriebsweite Tagesmeldung — reduziert (altes, schlankeres Raster) */}
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
              className="sticky left-0 z-10 flex shrink-0 items-center bg-gray-50 p-2 text-[10px] font-medium text-gray-600"
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
                    className="shrink-0 border-l border-gray-100 text-center text-[8px] text-gray-600 hover:bg-brand-50"
                    style={{ width: cellWidth, height: FARM_ROW_HEIGHT }}
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
