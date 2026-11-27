import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { loadJournalRows } from '../lib/journal'
import type { Parcel } from '../types'
import AckerToggle from '../components/AckerToggle'
import { useShowAcker, useShowSmall } from '../hooks/useShowAcker'
import { useQuery } from '../hooks/useQuery'
import { fmtDate } from '../lib/format'
import DayEntryEditor from '../components/DayEntryEditor'
import type { JournalRow } from '../lib/journal'
import { useSeasonYear } from '../hooks/useSeasonYear'
import SeasonYearSelect from '../components/SeasonYearSelect'


const KIND_LABEL: Record<JournalRow['kind'], string> = { nutzung: 'Nutzung', duengung: 'Düngung' }
const KIND_COLOR: Record<JournalRow['kind'], string> = {
  nutzung: 'bg-brand-100 text-brand-800',
  duengung: 'bg-amber-100 text-amber-800',
}

export default function Journal() {
  const [seasonYear, setSeasonYear] = useSeasonYear()
  const [showAcker] = useShowAcker()
  const [showSmall] = useShowSmall()
  const { data, loading, refresh } = useQuery((pg) => loadJournalRows(pg, seasonYear, showAcker, showSmall), [seasonYear, showAcker, showSmall])
  const [kindFilter, setKindFilter] = useState<'' | JournalRow['kind']>('')
  const [search, setSearch] = useState('')
  const [editorTarget, setEditorTarget] = useState<{ parcel: Parcel; date: string } | null>(null)
  const [params, setParams] = useSearchParams()
  // ?parzelle= (Steckbrief «Journal als Liste») bzw. ?parcel=: nur Einträge dieser Parzelle
  const parcelFilter = params.get('parzelle') ?? params.get('parcel')

  // Parzelle aus einem anderen Jahr (ohne ?jahr=): in ihr Jahr wechseln
  const { data: filterYear } = useQuery(
    async (pg) =>
      parcelFilter ? ((await pg.query<{ y: number }>('select season_year as y from parcels where id = $1', [parcelFilter])).rows[0]?.y ?? null) : null,
    [parcelFilter],
  )
  const yearFollowed = useRef<string | null>(null)
  useEffect(() => {
    if (filterYear == null || !parcelFilter || yearFollowed.current === parcelFilter) return
    yearFollowed.current = parcelFilter // nur einmal je Parzelle, danach gilt die Wahl
    if (!params.get('jahr') && Number(filterYear) !== seasonYear) setSeasonYear(Number(filterYear))
  }, [filterYear, parcelFilter, params, seasonYear, setSeasonYear])

  const clearParcelFilter = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('parzelle')
        next.delete('parcel')
        return next
      },
      { replace: true },
    )

  const rows = data?.rows ?? []
  const parcels = data?.parcels ?? []
  const filterParcelName = parcelFilter ? (parcels.find((p) => p.id === parcelFilter)?.name ?? 'gewählte Parzelle') : null
  const filtered = rows.filter((r) => {
    if (parcelFilter && r.parcelId !== parcelFilter) return false
    if (kindFilter && r.kind !== kindFilter) return false
    if (search && !r.parcelName.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      {/* Handy: Kopfzeile bricht um statt seitlich überzulaufen */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-xl font-bold text-gray-800">Journal {seasonYear}</h1>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <AckerToggle />
          <SeasonYearSelect value={seasonYear} onChange={setSeasonYear} />
        </div>
      </div>

      {filterParcelName && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">Gefiltert:</span>
          <button
            type="button"
            onClick={clearParcelFilter}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-100 px-3 font-medium text-brand-800"
            aria-label={`Filter Parzelle ${filterParcelName} aufheben`}
          >
            Parzelle {filterParcelName} <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}

      <div className="flex min-w-0 gap-2">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as '' | JournalRow['kind'])}
          className="min-h-11 min-w-0 rounded border border-gray-300 px-3 py-2 text-sm"
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
          aria-label="Parzelle suchen"
          className="min-h-11 min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}
      {data && filtered.length === 0 && <p className="text-center text-gray-500">Keine Einträge.</p>}

      <ul className="space-y-2">
        {filtered.map((row) => {
          const inner = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-gray-500">
                  {row.herd ? `${fmtDate(row.herd.from)}–${row.herd.to ? fmtDate(row.herd.to) : 'heute'}` : fmtDate(row.date)}
                </span>
                <span className="flex gap-1">
                  {row.herd && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">aus Herden</span>}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_COLOR[row.kind]}`}>
                    {KIND_LABEL[row.kind]}
                  </span>
                </span>
              </div>
              <div className="mt-1 font-semibold text-gray-800">
                {row.parcelName} · {row.summary}
              </div>
              {row.detail && <div className="mt-0.5 text-xs text-gray-500">{row.detail}</div>}
            </>
          )
          const cls = 'block w-full rounded-lg bg-white p-3 text-left shadow-sm active:bg-gray-50'
          return (
            <li key={`${row.kind}-${row.id}`}>
              {row.herd ? (
                // Weide aus einer Herde ändert man in der Herdengruppe (Modul Tiere), nicht als Tageseintrag
                <Link to={`/tiere?gruppe=${encodeURIComponent(row.herd.groupId)}`} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button type="button" className={cls} onClick={() => setEditorTarget({ parcel: row.parcel, date: row.date })}>
                  {inner}
                </button>
              )}
            </li>
          )
        })}
      </ul>

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
    </div>
  )
}
