import { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDateTime } from '../lib/format'
import type { DataHistory, HistoryAction } from '../types'

const TABLE_LABEL: Record<string, string> = {
  parcels: 'Parzelle',
  paddocks: 'Weidegang',
  usage_entries: 'Nutzung',
  fertilization_entries: 'Düngung',
  fertilization_shares: 'Düngung (Anteil)',
  fertilizer_types: 'Düngerart',
  n_dose_summary: 'Gabe (N)',
  daily_farm_log: 'Tagesmeldung',
  tracks: 'Track',
  weed_observations: 'Unkraut',
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

function describeEntry(entry: DataHistory): string {
  let snap: Record<string, unknown> = {}
  try {
    snap = JSON.parse(entry.snapshot)
  } catch {
    // Snapshot ist immer valides JSON (schreibt nur write.ts).
  }
  const s = (v: unknown) => (v == null ? null : String(v))

  switch (entry.table_name) {
    case 'parcels':
      return s(snap.name) ?? entry.row_id
    case 'paddocks':
      return s(snap.animal_group) ?? `Version ${s(snap.version_number) ?? '?'}`
    case 'usage_entries':
      return `${s(snap.usage_type) ?? '?'} (${s(snap.entry_date) ?? '?'})`
    case 'fertilization_entries':
      return `${s(snap.duengung_code) ?? '?'} (${s(snap.entry_date) ?? '?'})`
    case 'n_dose_summary':
      return `Gabe ${s(snap.gabe_number) ?? '?'}`
    case 'daily_farm_log':
      return s(snap.entry_date) ?? entry.row_id
    case 'tracks':
      return s(snap.label) ?? `${s(snap.point_count) ?? '?'} Punkte`
    case 'weed_observations':
      return `${s(snap.weed_type) ?? '?'}${snap.treatment ? ' · behandelt' : ''}`
    default:
      return entry.row_id
  }
}

export default function History() {
  const { data, loading } = useQuery(loadHistory)
  const [tableFilter, setTableFilter] = useState('')
  const [search, setSearch] = useState('')

  const entries = data ?? []

  const decorated = useMemo(
    () => entries.map((e) => ({ entry: e, label: describeEntry(e) })),
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
        {filtered.map(({ entry, label }) => (
          <li key={entry.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-500">
                {TABLE_LABEL[entry.table_name] ?? entry.table_name}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLOR[entry.action]}`}>
                {ACTION_LABEL[entry.action]}
              </span>
            </div>
            <div className="mt-1 font-semibold text-gray-800">{label}</div>
            <div className="mt-1 text-xs text-gray-500">
              {fmtDateTime(entry.changed_at)} · {entry.changed_by ?? 'unbekannt'}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
