import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type { DailyFarmLog, FertilizationEntry, Parcel, UsageEntry } from '../types'
import {
  USAGE_COLOR,
  USAGE_COLOR_FAMILY,
  abbreviateKultur,
  addDaysIso,
  fmtArea,
  todayIso,
  usageDescription,
  usageLegend,
} from '../lib/format'
import { groupUsageRuns, type UsageBar } from '../lib/journalRun'
import { primaryVirtualCategory, VIRTUAL_CATEGORY_COLOR } from '../lib/parcelFilter'
import { upsertRow } from '../db/write'
import type { SortField, SortState } from '../lib/parcelSort'
import type { ParcelSummary } from '../lib/parcelSummary'
import ParcelHeaderSort from './ParcelHeaderSort'
import { SUMMARY_TOTAL_WIDTH, SummaryHeaderCells, SummaryRowCells } from './ParcelSummaryColumns'
import { useViewportWidth, MOBILE_BREAKPOINT } from '../hooks/useViewportWidth'
import { useSelectedParcel } from '../hooks/useSelectedParcel'
import type { DayIndex } from './JournalGrid'

export const LABEL_COL_WIDTH = 190
const ROW_HEIGHT = 48
const FARM_ROW_HEIGHT = 24

// Zweite, kleine Zeile im Balken: bei Weide Tierart-Kürzel + Gruppe/Anzahl,
// sonst (falls vorhanden) die Tiergruppe/Bemerkung — reine Andeutung, Details
// bleiben im Tooltip/Editor.
function barDetail(e: UsageEntry): string | null {
  if (e.usage_type === 'weide') {
    if (e.animal_group) return e.animal_group
    if (e.animal_count) return `${e.animal_count} Tiere`
    return null
  }
  if (e.yield_amount != null) return `${e.yield_amount}${e.yield_unit ? ` ${e.yield_unit}` : ''}`
  if (e.value_num != null) return String(e.value_num)
  return null
}

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
  today,
  extendWindowStart,
  onDayClick,
  onFocusMap,
  onExtend,
  onOpenParcelSheet,
  showSummary,
  summary,
  labelColWidth,
  isMobile,
}: {
  parcel: Parcel
  days: string[]
  usageByDate: Record<string, UsageEntry[] | undefined>
  fertByDate: Record<string, FertilizationEntry[] | undefined>
  bars: UsageBar[]
  cellWidth: number
  trackWidth: number
  armedDate: string | null
  today: string
  extendWindowStart: string
  onDayClick: (parcel: Parcel, date: string, hasContent: boolean) => void
  onFocusMap: (parcel: Parcel) => void
  onExtend: (parcel: Parcel, bar: UsageBar, nextDate: string) => void
  onOpenParcelSheet: (parcel: Parcel) => void
  showSummary: boolean
  summary: ParcelSummary | undefined
  labelColWidth: number
  isMobile: boolean
}) {
  // Welcher Tag-Index gehört zu einem laufenden Balken (nicht sein erster
  // Tag) — dort keinen eigenen Klick-Button zeichnen, der Balken selbst
  // deckt die volle Spanne visuell ab.
  const coveredIdx = new Set<number>()
  for (const b of bars) for (let k = 1; k < b.span; k++) coveredIdx.add(b.startIdx + k)

  // Kulturcode statt ausgeschriebenem Namen spart Breite im zweizeiligen
  // Layout; Farbe nach virtueller Kategorie (Wiese/Weide/Acker/BFF) macht
  // sie auf einen Blick unterscheidbar. Ohne Code (z.B. manuell erfasste
  // Parzellen) bleibt der — auf Smartphones abgekürzte — Kulturname als
  // Fallback.
  const virtualCat = primaryVirtualCategory(parcel)
  const kulturColor = virtualCat ? VIRTUAL_CATEGORY_COLOR[virtualCat] : '#6b7280'
  const kulturFallbackText = parcel.kultur_name_de
    ? isMobile
      ? abbreviateKultur(parcel.kultur_name_de)
      : parcel.kultur_name_de
    : null

  // Markierung bleibt bestehen, bis die Zeile wieder abgewählt wird — auch
  // über einen Abstecher zur Karte (Globus) und zurück, siehe
  // hooks/useSelectedParcel.ts. Eigener Hook-Aufruf HIER statt als Prop von
  // aussen: so lösen nur die betroffenen zwei Zeilen (alte/neue Markierung)
  // ein Rerender aus, nicht alle — memo() oben bleibt dadurch wirksam.
  const { selectedId, toggle: toggleSelected, select: selectParcel } = useSelectedParcel()
  const isSelected = selectedId === parcel.id

  const acker = parcel.category === 'acker'
  const bgClass = isSelected ? 'bg-teal-100' : acker ? 'bg-amber-50' : 'bg-white'

  return (
    <>
      <div className={`flex border-b ${isSelected ? 'bg-teal-50' : acker ? 'bg-amber-50/40' : ''}`}>
        <div
          className={`sticky left-0 z-10 flex shrink-0 cursor-pointer flex-col justify-center gap-0.5 py-1 pl-1.5 pr-1 hover:brightness-95 active:brightness-90 ${bgClass} ${
            isSelected ? 'ring-2 ring-inset ring-teal-500' : ''
          }`}
          style={{ width: labelColWidth, height: ROW_HEIGHT }}
          onClick={() => {
            toggleSelected(parcel.id)
            onOpenParcelSheet(parcel)
          }}
          title="Parzellenblatt öffnen (Nutzungen, Düngungen) · markiert die Zeile"
        >
          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800" title={parcel.name}>
              {parcel.name}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                selectParcel(parcel.id)
                onFocusMap(parcel)
              }}
              title="Auf Karte zeigen"
              aria-label="Auf Karte zeigen"
              className="shrink-0 rounded text-xs leading-none active:bg-gray-100"
            >
              🌐
            </button>
          </div>
          <div className="truncate text-[10px] text-gray-400" title={`${fmtArea(parcel.area_a)}${parcel.kultur_name_de ? ' · ' + parcel.kultur_name_de : ''}`}>
            {parcel.kultur_code ? (
              <span style={{ color: kulturColor }} className="font-semibold">
                ({parcel.kultur_code})
              </span>
            ) : kulturFallbackText ? (
              <span style={{ color: kulturColor }} className="font-semibold">
                {kulturFallbackText}
              </span>
            ) : null}
            {' '}
            {fmtArea(parcel.area_a)}
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
              } ${d === today ? 'bg-yellow-200/60' : isWeekend(d) ? 'bg-gray-50' : ''}`}
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
          const detail = bar.span * cellWidth >= 24 ? barDetail(bar.entry) : null
          const left = bar.startIdx * cellWidth + 2
          const width = bar.span * cellWidth - 4
          return (
            <div
              key={`${bar.entry.id}-${bar.startIdx}`}
              className="pointer-events-none absolute flex flex-col items-center justify-center overflow-hidden whitespace-nowrap rounded leading-none"
              style={{
                left,
                width: Math.max(width, 8),
                top: 3,
                height: ROW_HEIGHT - 10,
                background: dayOnly ? `${color}22` : color,
                border: dayOnly ? `1.5px solid ${color}` : 'none',
                color: dayOnly ? color : '#ffffff',
                // Planungseintrag: auffälliger gestrichelter Rahmen, unabhängig
                // von der Tagweide-Umrandung oben (eigene CSS-Eigenschaft, kein
                // Konflikt mit "border").
                outline: bar.entry.is_planned ? '2px dashed #1e293b' : 'none',
                outlineOffset: bar.entry.is_planned ? 1 : 0,
              }}
              title={bar.entry.is_planned ? 'Geplant — noch kein definitiver Eintrag' : undefined}
            >
              <span className="text-[10px] font-bold">{letter}</span>
              {detail && <span className="mt-0.5 max-w-full truncate text-[8px] font-normal opacity-90">{detail}</span>}
            </div>
          )
        })}

        {/* "Verlängern"-Knopf: bei Balken, deren letzter Tag innerhalb der
            letzten 7 Tage (bis heute) liegt, einen Tag anhängen statt den
            ganzen Editor zu öffnen — für laufende Massnahmen wie Weide, die
            man Tag für Tag nachträgt. Nur wenn der Folgetag noch frei ist
            und innerhalb der Saison liegt. */}
        {bars.map((bar) => {
          // Weide aus Herden verlängert sich von selbst (lib/herdModel.ts)
          if (bar.entry.herd_group_id) return null
          const endIdx = bar.startIdx + bar.span - 1
          const endDate = days[endIdx]
          if (endDate < extendWindowStart || endDate > today) return null
          const nextIdx = endIdx + 1
          if (nextIdx >= days.length) return null
          const nextDate = days[nextIdx]
          const nextHasContent = (usageByDate[nextDate]?.length ?? 0) > 0 || (fertByDate[nextDate]?.length ?? 0) > 0
          if (nextHasContent) return null
          return (
            <button
              key={`extend-${bar.entry.id}`}
              type="button"
              onClick={() => onExtend(parcel, bar, nextDate)}
              title={`Verlängern auf ${nextDate}`}
              aria-label="Um einen Tag verlängern"
              className="absolute flex items-center justify-center rounded-full border border-brand-600 bg-white text-[10px] font-bold leading-none text-brand-600 shadow hover:bg-brand-50"
              style={{ left: nextIdx * cellWidth + 2, top: ROW_HEIGHT / 2 - 8, width: 16, height: 16 }}
            >
              +
            </button>
          )
        })}

        {/* Düngung: eigener Streifen unten, unabhängig von der Nutzungsfarbe —
            ab genug Platz zusätzlich die Menge klein angedeutet. */}
        {days.map((d, idx) => {
          const fert = fertByDate[d] ?? []
          if (fert.length === 0) return null
          const amount = fert[0].amount
          const showAmount = cellWidth >= 24 && amount != null
          const planned = fert[0].is_planned
          return (
            <div
              key={`fert-${d}`}
              className="pointer-events-none absolute"
              style={{ left: idx * cellWidth + 2, width: cellWidth - 4, bottom: 3 }}
              title={planned ? 'Geplant — noch kein definitiver Eintrag' : undefined}
            >
              {showAmount && (
                <div className="mb-0.5 truncate text-center text-[7px] font-semibold leading-none text-amber-800">
                  {amount}
                </div>
              )}
              <div
                className="rounded-sm"
                style={
                  planned
                    ? { height: 4, background: '#92400e22', border: '1.5px dashed #92400e' }
                    : { height: 4, background: '#92400e' }
                }
              />
            </div>
          )
        })}
      </div>
      {showSummary && <SummaryRowCells summary={summary} height={ROW_HEIGHT} tinted={parcel.category === 'acker'} />}
      </div>
    </>
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
  onOpenParcelSheet: (parcel: Parcel) => void
  cellWidth?: number
  scrollRef?: (node: HTMLDivElement | null) => void
  stickyTop?: number
  sort: SortState
  onSort: (field: SortField) => void
  showSummary?: boolean
  summary?: Record<string, ParcelSummary>
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
  onOpenParcelSheet,
  cellWidth = 28,
  scrollRef,
  stickyTop = 0,
  sort,
  onSort,
  showSummary = false,
  summary,
}: Props) {
  const trackWidth = days.length * cellWidth

  // Erste Spalte auf Smartphones schmaler (max. 25% der Bildschirmbreite)
  // und mit Kultur-Abkürzung statt vollem Namen — auf Desktop bleibt es beim
  // festen LABEL_COL_WIDTH.
  const viewportWidth = useViewportWidth()
  const isMobile = viewportWidth < MOBILE_BREAKPOINT
  const labelColWidth = isMobile ? Math.round(viewportWidth * 0.25) : LABEL_COL_WIDTH

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

  const today = todayIso()
  const extendWindowStart = addDaysIso(today, -7)

  // "Verlängern"-Knopf: identischen Eintrag einen Tag weiter anlegen, ohne
  // den Editor zu öffnen. Erntewert (yield_amount) bewusst NICHT übernommen
  // — der würde sich sonst Tag für Tag verdoppeln statt einmalig zu gelten.
  const handleExtend = useCallback((parcel: Parcel, bar: UsageBar, nextDate: string) => {
    const e = bar.entry
    void upsertRow('usage_entries', {
      id: crypto.randomUUID(),
      parcel_id: parcel.id,
      entry_date: nextDate,
      usage_type: e.usage_type,
      animal_category: e.animal_category,
      day_only: e.day_only,
      animal_count: e.animal_count,
      animal_group: e.animal_group,
      label: e.label,
      value_num: null,
      yield_amount: null,
      yield_unit: null,
      paddock_version_id: e.paddock_version_id,
      notes: e.notes,
      import_key: null,
      is_planned: e.is_planned,
    } as never)
  }, [])

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-lg bg-white shadow-sm"
      // "Magnetische" Monatsgrenzen: proximity statt mandatory, damit nur
      // schnelle/weite Scrolls in der Nähe eines Monatsanfangs einrasten —
      // feines Scrollen Tag für Tag bleibt frei (siehe scrollSnapAlign an
      // den Monats-Erster-Tag-Zellen unten).
      style={{ maxHeight: `calc(100vh - ${stickyTop + 170}px)`, scrollSnapType: 'x proximity' }}
    >
      <div style={{ minWidth: labelColWidth + trackWidth + (showSummary ? SUMMARY_TOTAL_WIDTH : 0) }}>
        {/* Monats-/Tages-Header — sticky innerhalb DIESES Containers, siehe
            Kommentar in JournalGrid.tsx (gleicher Grund). */}
        <div className="sticky top-0 z-30 flex border-b bg-white">
          <div className="sticky left-0 z-20 flex shrink-0 items-center bg-white px-1.5 py-2" style={{ width: labelColWidth }}>
            <ParcelHeaderSort sort={sort} onSort={onSort} />
          </div>
          <div className="flex">
            {days.map((d) => {
              const { dow, dom, isFirstOfMonth } = shortDay(d)
              return (
                <div
                  key={d}
                  className={`shrink-0 pt-1 text-center text-[8px] leading-tight text-gray-400 ${
                    isFirstOfMonth ? 'border-l-2 border-gray-300' : 'border-l border-gray-100'
                  } ${d === today ? 'bg-yellow-300/70 font-bold text-gray-700' : isWeekend(d) ? 'bg-gray-100' : ''}`}
                  style={{ width: cellWidth, scrollSnapAlign: isFirstOfMonth ? 'start' : undefined }}
                >
                  {isFirstOfMonth && <div className="font-semibold text-gray-600">{monthLabel(d)}</div>}
                  <div>{dow}</div>
                  <div>{dom}</div>
                </div>
              )
            })}
          </div>
          {showSummary && <SummaryHeaderCells />}
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
            labelColWidth={labelColWidth}
            isMobile={isMobile}
            armedDate={armed?.parcelId === p.id ? armed.date : null}
            today={today}
            extendWindowStart={extendWindowStart}
            onDayClick={handleDayClick}
            onFocusMap={onFocusMap}
            onExtend={handleExtend}
            onOpenParcelSheet={onOpenParcelSheet}
            showSummary={showSummary}
            summary={summary?.[p.id]}
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
              className="sticky left-0 z-10 flex shrink-0 items-center truncate bg-gray-50 p-2 text-[10px] font-medium text-gray-600"
              style={{ width: labelColWidth, height: FARM_ROW_HEIGHT }}
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
                // Automatisch vom (künftigen) Geodatenserver übernommene
                // Werte kursiv andeuten — lokale Eingabe (Standard) bleibt
                // normal; siehe DailyLogEditor.tsx.
                const fromGeodata = (row.key === 'wetter_code' || row.key === 'niederschlag_mm') && log?.wetter_quelle === 'geodaten'
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onFarmCellClick(d)}
                    title={fromGeodata ? 'Automatisch vom Geodatenserver' : undefined}
                    className={`shrink-0 border-l border-gray-100 text-center text-[8px] text-gray-600 hover:bg-brand-50 ${fromGeodata ? 'italic text-sky-700' : ''}`}
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
