import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDateTime } from '../lib/format'
import type { DataHistory, HistoryAction } from '../types'

const TABLE_LABEL: Record<string, string> = {
  animals: 'Kuh',
  milk_tests: 'Milchtest',
}

const ACTION_LABEL: Record<HistoryAction, string> = {
  insert: 'Neu',
  update: 'Geändert',
  delete: 'Gelöscht',
}

const ACTION_COLOR: Record<HistoryAction, string> = {
  insert: 'bg-green-100 text-green-800',
  update: 'bg-blue-100 text-blue-800',
  delete: 'bg-red-100 text-red-800',
}

async function loadHistory(pg: PGlite): Promise<DataHistory[]> {
  const { rows } = await pg.query<DataHistory>(
    'select * from data_history order by changed_at desc limit 300',
  )
  return rows
}

/** Extrahiert eine sprechende Kurzbeschreibung + optionalen Detail-Link aus dem Snapshot. */
function describeEntry(entry: DataHistory): { label: string; link: string | null } {
  let snap: Record<string, unknown> = {}
  try {
    snap = JSON.parse(entry.snapshot)
  } catch {
    // Snapshot sollte immer valides JSON sein (schreibt nur write.ts) — falls
    // doch nicht, einfach ohne Detaillabel weitermachen.
  }
  const s = (v: unknown) => (v == null ? null : String(v))

  switch (entry.table_name) {
    case 'animals':
      return { label: s(snap.ear_tag) ?? entry.row_id, link: `/kuehe/${entry.row_id}` }
    case 'milk_tests':
      return {
        label: `${s(snap.milk_kg) ?? '?'} kg am ${s(snap.test_date) ?? '?'}`,
        link: snap.animal_id ? `/kuehe/${s(snap.animal_id)}` : null,
      }
    default:
      return { label: entry.row_id, link: null }
  }
}

export default function History() {
  const { data, loading } = useQuery(loadHistory)
  const [tableFilter, setTableFilter] = useState('')
  const [search, setSearch] = useState('')

  const entries = data ?? []

  const decorated = useMemo(
    () => entries.map((e) => ({ entry: e, ...describeEntry(e) })),
    [entries],
  )

  const filtered = decorated.filter(({ entry, label }) => {
    if (tableFilter && entry.table_name !== tableFilter) return false
    if (search && !label.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const availableTables = [...new Set(entries.map((e) => e.table_name))]

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Verlauf</h1>

      <div className="flex gap-2">
        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Alle Bereiche</option>
          {availableTables.map((t) => (
            <option key={t} value={t}>
              {TABLE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Suche…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && filtered.length === 0 && (
        <p className="text-center text-gray-500">Keine Einträge.</p>
      )}

      <ul className="space-y-2">
        {filtered.map(({ entry, label, link }) => (
          <li key={entry.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-500">
                {TABLE_LABEL[entry.table_name] ?? entry.table_name}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLOR[entry.action]}`}>
                {ACTION_LABEL[entry.action]}
              </span>
            </div>
            <div className="mt-1 font-semibold text-gray-800">
              {link ? (
                <Link to={link} className="text-brand-700">
                  {label}
                </Link>
              ) : (
                label
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {fmtDateTime(entry.changed_at)} · {entry.changed_by ?? 'unbekannt'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
