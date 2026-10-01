import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { loadEntriesInRange } from '../lib/journalEntry'
import { loadSharesInRange } from '../lib/fertilization'
import JournalGridComponent, { type DayIndex, LABEL_COL_WIDTH as LABEL_COL_WIDTH_NEU } from '../components/JournalGrid'
import JournalGridClassic, { LABEL_COL_WIDTH as LABEL_COL_WIDTH_KLASSISCH } from '../components/JournalGridClassic'
import DayEntryEditor from '../components/DayEntryEditor'
import DayEntryEditorClassic from '../components/DayEntryEditorClassic'
import GabenPanel from '../components/GabenPanel'
import ParcelSheetModal from '../components/ParcelSheetModal'
import DailyLogEditor from '../components/DailyLogEditor'
import AckerToggle from '../components/AckerToggle'
import GridViewToggle from '../components/GridViewToggle'
import GridZoomControl from '../components/GridZoomControl'
import ParcelFilterBar from '../components/ParcelFilterBar'
import ToggleSwitch from '../components/ToggleSwitch'
import { categoryFilterSql, useShowAcker } from '../hooks/useShowAcker'
import { useGridView } from '../hooks/useGridView'
import { useGridZoom, READABLE_CELL_WIDTH } from '../hooks/useGridZoom'
import { useRestoreScroll } from '../hooks/useRestoreScroll'
import { useStickyTopOffset } from '../hooks/useStickyTopOffset'
import { useViewportWidth, MOBILE_BREAKPOINT } from '../hooks/useViewportWidth'
import { sortParcels, nextSortState, type SortState } from '../lib/parcelSort'
import { matchesVirtualCategory, parcelMatchesChip, type FilterChip } from '../lib/parcelFilter'
import { summarizeParcels } from '../lib/parcelSummary'
import type { DailyFarmLog, FertilizationEntry, Parcel, UsageEntry } from '../types'
import { isoDate, num, todayIso } from '../lib/format'

const CURRENT_YEAR = new Date().getFullYear()

function seasonDays(year: number): string[] {
  const days: string[] = []
  const start = new Date(Date.UTC(year, 2, 1)) // 1. März
  const end = new Date(Date.UTC(year, 9, 31)) // 31. Oktober
  for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function indexByParcelAndDay<T extends { parcel_id: string; entry_date: string }>(rows: T[]): DayIndex<T> {
  const idx: DayIndex<T> = {}
  for (const row of rows) {
    idx[row.parcel_id] ??= {}
    idx[row.parcel_id][row.entry_date] ??= []
    idx[row.parcel_id][row.entry_date].push(row)
  }
  return idx
}

async function loadGridData(pg: PGlite, seasonYear: number, from: string, to: string, showAcker: boolean) {
  const [{ rows: parcels }, { usage, fertilizations }, { rows: dailyLogs }, shares] = await Promise.all([
    pg.query<Parcel>(
      `select * from parcels where season_year = $1 and deleted_at is null${categoryFilterSql(showAcker)}
       order by farm_name nulls last, category, sort_order, name`,
      [seasonYear],
    ),
    loadEntriesInRange(pg, from, to),
    pg.query<DailyFarmLog>('select * from daily_farm_log where entry_date between $1 and $2 and deleted_at is null', [from, to]),
    loadSharesInRange(pg, from, to),
  ])
  return { parcels, usage, fertilizations, dailyLogs, shares }
}

export default function JournalGridPage() {
  const navigate = useNavigate()
  const [seasonYear, setSeasonYear] = useState(CURRENT_YEAR)
  const days = useMemo(() => seasonDays(seasonYear), [seasonYear])
  const from = days[0]
  const to = days[days.length - 1]

  const [showAcker] = useShowAcker()
  const [view] = useGridView()
  const { cellWidth, setCellWidth } = useGridZoom()
  const stickyTop = useStickyTopOffset()
  const todayIdx = days.indexOf(todayIso())
  const scroll = useRestoreScroll(
    `wiesenjournal-grid-${view}-${seasonYear}`,
    todayIdx >= 0 ? todayIdx : undefined,
    cellWidth,
  )
  // Muss dieselbe Logik wie JournalGridClassic.tsx verwenden, sonst würde
  // "Ganzes Jahr zoomen" auf dem Handy eine zu breite/schmale Spalte annehmen.
  const viewportWidth = useViewportWidth()
  const isMobile = viewportWidth < MOBILE_BREAKPOINT
  const labelColWidth =
    view === 'neu' ? LABEL_COL_WIDTH_NEU : isMobile ? Math.round(viewportWidth * 0.25) : LABEL_COL_WIDTH_KLASSISCH

  function goToToday() {
    setCellWidth(READABLE_CELL_WIDTH)
    if (todayIdx >= 0) requestAnimationFrame(() => scroll.scrollToIndex(todayIdx, READABLE_CELL_WIDTH))
  }
  function fitToYear() {
    const fit = scroll.fitCellWidth(days.length, labelColWidth)
    if (fit > 0) setCellWidth(fit)
  }

  const { data, loading, refresh } = useQuery(
    (pg) => loadGridData(pg, seasonYear, from, to, showAcker),
    [seasonYear, from, to, showAcker],
  )

  const [editorTarget, setEditorTarget] = useState<{ parcel: Parcel; date: string } | null>(null)
  const [gabenTarget, setGabenTarget] = useState<Parcel | null>(null)
  const [sheetTarget, setSheetTarget] = useState<Parcel | null>(null)
  const [farmLogDate, setFarmLogDate] = useState<string | null>(null)

  // Filter (Freitext + Vorschlags-Knöpfe) und Sortierung — siehe
  // components/ParcelFilterBar.tsx / ParcelHeaderSort.tsx / lib/parcelSort.ts.
  const [search, setSearch] = useState('')
  const [filterChips, setFilterChips] = useState<FilterChip[]>([])
  const [sort, setSort] = useState<SortState>({ field: null, dir: 'asc' })
  const [summaryOpen, setSummaryOpen] = useState(false)
  // "Aktive zuerst": Parzellen mit Eintrag im sichtbaren Datumsbereich nach
  // oben — reine Anzeige-Umschichtung NACH der Sortierung, verändert deren
  // Ergebnis innerhalb der zwei Gruppen nicht (Array.sort ist stabil).
  const [activeFirst, setActiveFirst] = useState(false)
  // "BFF": schneller Zugriff auf dieselbe Kategorie, die auch als Filter-Chip
  // existiert (lib/parcelFilter.ts) — als eigener Schalter statt nur über
  // das Filterfeld, weil die BFF-Ansicht für Beitragsnachweise regelmässig
  // gebraucht wird. Session-only wie "Aktive zuerst", keine Dauereinstellung.
  const [bffOnly, setBffOnly] = useState(false)

  const allParcels = data?.parcels ?? []
  const parcels = useMemo(() => {
    let list = allParcels
    if (filterChips.length > 0) {
      list = list.filter((p) => filterChips.some((c) => parcelMatchesChip(p, c)))
    }
    if (bffOnly) {
      list = list.filter((p) => matchesVirtualCategory(p, 'bff'))
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.kultur_name_de ?? '').toLowerCase().includes(q))
    }
    return sortParcels(list, sort)
  }, [allParcels, filterChips, bffOnly, search, sort])

  const usageByDay = useMemo(() => indexByParcelAndDay<UsageEntry>(data?.usage ?? []), [data])
  // Düngung je Parzelle über die Anteile (Polygon/Track/mehrere Parzellen
  // erscheinen auf jeder betroffenen Zeile); Massnahmen ohne Anteile über
  // die Anker-Parzelle.
  const fertByDay = useMemo(() => {
    const entries = data?.fertilizations ?? []
    const byId = new Map(entries.map((e) => [e.id, e]))
    const withShare = new Set<string>()
    const rows: { parcel_id: string; entry_date: string; entry: FertilizationEntry }[] = []
    for (const { share, entry_date } of data?.shares ?? []) {
      const entry = byId.get(share.entry_id)
      if (!entry) continue
      withShare.add(entry.id)
      rows.push({ parcel_id: share.parcel_id, entry_date, entry })
    }
    for (const e of entries) {
      if (!withShare.has(e.id) && e.parcel_id) rows.push({ parcel_id: e.parcel_id, entry_date: e.entry_date, entry: e })
    }
    const idx: DayIndex<FertilizationEntry> = {}
    for (const r of rows) {
      idx[r.parcel_id] ??= {}
      idx[r.parcel_id][r.entry_date] ??= []
      if (!idx[r.parcel_id][r.entry_date].some((x) => x.id === r.entry.id)) idx[r.parcel_id][r.entry_date].push(r.entry)
    }
    return idx
  }, [data])
  const dailyLogByDate = useMemo(() => {
    const idx: Record<string, DailyFarmLog> = {}
    for (const log of data?.dailyLogs ?? []) idx[isoDate(log.entry_date)] = log
    return idx
  }, [data])
  const summaryByParcel = useMemo(
    () => (summaryOpen ? summarizeParcels(parcels, usageByDay, fertByDay) : undefined),
    [summaryOpen, parcels, usageByDay, fertByDay],
  )
  const displayParcels = useMemo(() => {
    if (!activeFirst) return parcels
    const hasEntry = (id: string) =>
      !!(usageByDay[id] && Object.keys(usageByDay[id]).length) || !!(fertByDay[id] && Object.keys(fertByDay[id]).length)
    return [...parcels].sort((a, b) => Number(hasEntry(b.id)) - Number(hasEntry(a.id)))
  }, [parcels, activeFirst, usageByDay, fertByDay])

  return (
    <div className="space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800">Journal-Raster {seasonYear}</h1>
          <ParcelFilterBar parcels={allParcels} search={search} onSearchChange={setSearch} chips={filterChips} onChipsChange={setFilterChips} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AckerToggle />
          <ToggleSwitch
            checked={bffOnly}
            onChange={setBffOnly}
            label="BFF"
            title="Nur Biodiversitätsförderflächen (BFF) anzeigen"
          />
          <ToggleSwitch
            checked={activeFirst}
            onChange={setActiveFirst}
            label="Aktive zuerst"
            title="Parzellen mit Eintrag im angezeigten Zeitraum nach oben"
          />
          <GridViewToggle />
          <GridZoomControl />
          <button
            type="button"
            onClick={goToToday}
            title="Zum heutigen Datum springen und lesbar zoomen"
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600"
          >
            📍 Heute
          </button>
          <button
            type="button"
            onClick={fitToYear}
            title="Auf ganzes Jahr zoomen"
            className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600"
          >
            🗓️⇔ Jahr
          </button>
          <button
            type="button"
            onClick={() => setSummaryOpen((v) => !v)}
            title="Zusammenfassung je Parzelle ein-/ausblenden (Weidetage, Ertrag, Stickstoff)"
            className={`rounded border px-2 py-1 text-xs font-medium ${
              summaryOpen ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-300 text-gray-600'
            }`}
          >
            Σ Zusammenfassung
          </button>
          <select
            value={seasonYear}
            onChange={(e) => setSeasonYear(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && allParcels.length === 0 && (
        <p className="text-center text-gray-500">
          Noch keine Parzellen für {seasonYear} — unter „Parzellen" aus GELAN übernehmen oder anlegen.
        </p>
      )}
      {data && allParcels.length > 0 && parcels.length === 0 && (
        <p className="text-center text-gray-500">Keine Parzelle passt auf den aktuellen Filter.</p>
      )}

      {parcels.length > 0 && view === 'neu' && (
        <JournalGridComponent
          parcels={displayParcels}
          days={days}
          usageByDay={usageByDay}
          fertByDay={fertByDay}
          dailyLogByDate={dailyLogByDate}
          cellWidth={cellWidth}
          scrollRef={scroll.ref}
          stickyTop={stickyTop}
          sort={sort}
          onSort={(field) => setSort((s) => nextSortState(s, field))}
          showSummary={summaryOpen}
          summary={summaryByParcel}
          onCellClick={(parcel, date) => setEditorTarget({ parcel, date })}
          onFarmCellClick={(date) => setFarmLogDate(date)}
          onOpenParcelSheet={(parcel) => setSheetTarget(parcel)}
          onFocusMap={(parcel) => navigate(`/wiesenjournal/karte?parcel=${parcel.id}`)}
        />
      )}

      {parcels.length > 0 && view === 'klassisch' && (
        <JournalGridClassic
          parcels={displayParcels}
          days={days}
          usageByDay={usageByDay}
          fertByDay={fertByDay}
          dailyLogByDate={dailyLogByDate}
          cellWidth={cellWidth}
          scrollRef={scroll.ref}
          stickyTop={stickyTop}
          sort={sort}
          onSort={(field) => setSort((s) => nextSortState(s, field))}
          showSummary={summaryOpen}
          summary={summaryByParcel}
          onDayOpen={(parcel, date) => setEditorTarget({ parcel, date })}
          onFarmCellClick={(date) => setFarmLogDate(date)}
          onOpenParcelSheet={(parcel) => setSheetTarget(parcel)}
          onFocusMap={(parcel) => navigate(`/wiesenjournal/karte?parcel=${parcel.id}`)}
        />
      )}

      {editorTarget && view === 'neu' && (
        <DayEntryEditor
          parcel={editorTarget.parcel}
          parcels={parcels}
          seasonYear={seasonYear}
          date={editorTarget.date}
          onClose={() => setEditorTarget(null)}
          onSaved={refresh}
        />
      )}
      {editorTarget && view === 'klassisch' && (
        <DayEntryEditorClassic
          parcel={editorTarget.parcel}
          seasonYear={seasonYear}
          date={editorTarget.date}
          onClose={() => setEditorTarget(null)}
          onSaved={refresh}
        />
      )}
      {gabenTarget && (
        <GabenPanel
          parcelId={gabenTarget.id}
          parcelName={gabenTarget.name}
          parcelAreaA={num(gabenTarget.area_a)}
          seasonYear={seasonYear}
          onClose={() => setGabenTarget(null)}
        />
      )}
      {sheetTarget && (
        <ParcelSheetModal
          parcel={sheetTarget}
          seasonYear={seasonYear}
          usageByDate={usageByDay[sheetTarget.id]}
          fertByDate={fertByDay[sheetTarget.id]}
          onOpenDay={(date) => setEditorTarget({ parcel: sheetTarget, date })}
          onOpenGaben={() => {
            setGabenTarget(sheetTarget)
            setSheetTarget(null)
          }}
          onClose={() => setSheetTarget(null)}
        />
      )}
      {farmLogDate && <DailyLogEditor date={farmLogDate} onClose={() => setFarmLogDate(null)} onSaved={refresh} />}
    </div>
  )
}
