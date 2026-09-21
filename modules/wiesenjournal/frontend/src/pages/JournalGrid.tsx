import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { loadEntriesInRange } from '../lib/journalEntry'
import { loadSharesInRange } from '../lib/fertilization'
import JournalGridComponent, { type DayIndex } from '../components/JournalGrid'
import DayEntryEditor from '../components/DayEntryEditor'
import GabenPanel from '../components/GabenPanel'
import DailyLogEditor from '../components/DailyLogEditor'
import AckerToggle from '../components/AckerToggle'
import { categoryFilterSql, useShowAcker } from '../hooks/useShowAcker'
import type { DailyFarmLog, FertilizationEntry, Parcel, UsageEntry } from '../types'
import { isoDate, num } from '../lib/format'

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
  const { data, loading, refresh } = useQuery(
    (pg) => loadGridData(pg, seasonYear, from, to, showAcker),
    [seasonYear, from, to, showAcker],
  )

  const [editorTarget, setEditorTarget] = useState<{ parcel: Parcel; date: string } | null>(null)
  const [gabenTarget, setGabenTarget] = useState<Parcel | null>(null)
  const [farmLogDate, setFarmLogDate] = useState<string | null>(null)

  const parcels = data?.parcels ?? []
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

  return (
    <div className="space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Journal-Raster {seasonYear}</h1>
        <div className="flex items-center gap-3">
        <AckerToggle />
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
      {data && parcels.length === 0 && (
        <p className="text-center text-gray-500">
          Noch keine Parzellen für {seasonYear} — unter „Parzellen" aus GELAN übernehmen oder anlegen.
        </p>
      )}

      {parcels.length > 0 && (
        <JournalGridComponent
          parcels={parcels}
          days={days}
          usageByDay={usageByDay}
          fertByDay={fertByDay}
          dailyLogByDate={dailyLogByDate}
          onCellClick={(parcel, date) => setEditorTarget({ parcel, date })}
          onFarmCellClick={(date) => setFarmLogDate(date)}
          onGabenClick={(parcel) => setGabenTarget(parcel)}
          onFocusMap={(parcel) => navigate(`../karte?parcel=${parcel.id}`)}
        />
      )}

      {editorTarget && (
        <DayEntryEditor
          parcel={editorTarget.parcel}
          parcels={parcels}
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
      {farmLogDate && <DailyLogEditor date={farmLogDate} onClose={() => setFarmLogDate(null)} onSaved={refresh} />}
    </div>
  )
}
