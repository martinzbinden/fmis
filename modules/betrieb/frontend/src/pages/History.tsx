import { useMemo, useState } from 'react'
import { useServerHistory } from '@fmis/core/historyApi'
import { fmtDateTime } from '../lib/format'
import type { DataHistory, HistoryAction } from '../types'

const TABLE_LABEL: Record<string, string> = {
  machines: 'Maschine',
  machine_files: 'Maschinen-Datei',
  maintenance_tasks: 'Wartungsplan',
  maintenance_log: 'Wartungsjournal',
  machine_todos: 'Pendenz',
  tracks: 'Spur',
  tank_events: 'Fass',
  duty_people: 'Person',
  duty_types: 'Dienst',
  duty_skills: 'Fähigkeit',
  duty_absences: 'Abwesenheit',
  duty_shifts: 'Einteilung',
  duty_changes: 'Diensttausch',
  duty_requests: 'Dienst-Antrag',
  duty_templates: 'Standardplan',
  duty_template_slots: 'Standardplan-Platz',
  duty_weeks: 'Dienstwoche',
  machine_settings: 'Geräteeinstellung',
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

function describeEntry(entry: DataHistory): string {
  let snap: Record<string, unknown> = {}
  try {
    snap = JSON.parse(entry.snapshot)
  } catch {
    // Snapshot ist immer valides JSON (schreibt nur write.ts).
  }
  const s = (v: unknown) => (v == null ? null : String(v))

  switch (entry.table_name) {
    case 'machines':
    case 'duty_people':
    case 'duty_types':
      return s(snap.name) ?? entry.row_id
    case 'maintenance_tasks':
    case 'machine_todos':
    case 'maintenance_log':
      return `${s(snap.title) ?? s(snap.entry_type) ?? '?'}${snap.done_date ? ` (${s(snap.done_date)})` : ''}`
    case 'tracks':
      return s(snap.label) ?? s(snap.work_type) ?? `${s(snap.point_count) ?? '?'} Punkte`
    case 'duty_shifts':
    case 'duty_changes':
      return s(snap.date) ?? entry.row_id
    case 'duty_requests':
      return `${s(snap.kind) ?? '?'} ${s(snap.date) ?? s(snap.from_date) ?? ''} (${s(snap.status) ?? '?'})`
    case 'duty_absences':
      return `${s(snap.kind) ?? '?'} ${s(snap.from_date) ?? ''}–${s(snap.to_date) ?? ''}`
    case 'machine_settings':
      return s(snap.crop) ?? s(snap.set_at) ?? entry.row_id
    default:
      return entry.row_id
  }
}

export default function History() {
  const { entries: data, loading, error, reload } = useServerHistory('betrieb')
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

      {error && (
        <div className="rounded-lg bg-amber-50 p-3 text-center text-sm text-amber-800">
          <p>{error}</p>
          <p className="mt-1 text-xs text-amber-700">
            Der Verlauf wird vom Server gelesen und ist deshalb offline nicht verfügbar.
          </p>
          <button type="button" onClick={reload} className="mt-2 rounded bg-amber-700 px-3 py-1 text-xs font-semibold text-white">
            Nochmals versuchen
          </button>
        </div>
      )}
      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}
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
