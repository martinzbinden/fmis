import { useState } from 'react'
import { loadJournalRows } from '../lib/journal'
import AckerToggle from '../components/AckerToggle'
import { useShowAcker } from '../hooks/useShowAcker'
import { useQuery } from '../hooks/useQuery'
import { fmtDate } from '../lib/format'
import DayEntryEditor from '../components/DayEntryEditor'
import type { JournalRow } from '../lib/journal'

const CURRENT_YEAR = new Date().getFullYear()

const KIND_LABEL: Record<JournalRow['kind'], string> = { nutzung: 'Nutzung', duengung: 'Düngung' }
const KIND_COLOR: Record<JournalRow['kind'], string> = {
  nutzung: 'bg-brand-100 text-brand-800',
  duengung: 'bg-amber-100 text-amber-800',
}

export default function Journal() {
  const [seasonYear, setSeasonYear] = useState(CURRENT_YEAR)
  const [showAcker] = useShowAcker()
  const { data, loading, refresh } = useQuery((pg) => loadJournalRows(pg, seasonYear, showAcker), [seasonYear, showAcker])
  const [kindFilter, setKindFilter] = useState<'' | JournalRow['kind']>('')
  const [search, setSearch] = useState('')
  const [editorTarget, setEditorTarget] = useState<{ parcelId: string; parcelName: string; date: string } | null>(null)

  const rows = data ?? []
  const filtered = rows.filter((r) => {
    if (kindFilter && r.kind !== kindFilter) return false
    if (search && !r.parcelName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Journal {seasonYear}</h1>
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

      <div className="flex gap-2">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as '' | JournalRow['kind'])}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Alle Arten</option>
          <option value="nutzung">Nutzung</option>
          <option value="duengung">Düngung</option>
        </select>
        <input
          type="text"
          placeholder="Parzelle suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && filtered.length === 0 && <p className="text-center text-gray-500">Keine Einträge.</p>}

      <ul className="space-y-2">
        {filtered.map((row) => (
          <li
            key={`${row.kind}-${row.id}`}
            className="cursor-pointer rounded-lg bg-white p-3 shadow-sm"
            onClick={() => setEditorTarget({ parcelId: row.parcelId, parcelName: row.parcelName, date: row.date })}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-500">{fmtDate(row.date)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_COLOR[row.kind]}`}>
                {KIND_LABEL[row.kind]}
              </span>
            </div>
            <div className="mt-1 font-semibold text-gray-800">
              {row.parcelName} · {row.summary}
            </div>
            {row.detail && <div className="mt-0.5 text-xs text-gray-500">{row.detail}</div>}
          </li>
        ))}
      </ul>

      {editorTarget && (
        <DayEntryEditor
          parcelId={editorTarget.parcelId}
          parcelName={editorTarget.parcelName}
          date={editorTarget.date}
          onClose={() => setEditorTarget(null)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
