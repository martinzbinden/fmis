import { useMemo, useState } from 'react'
import { fmtDate } from '../lib/format'
import type { Animal } from '../types'

export interface AnimalRow extends Animal {
  milk_test_count: number
}

// Alle wählbaren Spalten; die Auswahl wird pro Instanz in localStorage
// gemerkt (reine Anzeige-Einstellung, kein Sync).
const COLUMNS: { key: keyof AnimalRow; label: string; format?: (v: unknown) => string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'ear_tag', label: 'Ohrmarke' },
  { key: 'breed_code', label: 'Rasse' },
  { key: 'sex', label: 'Geschlecht', format: (v) => (v === 'w' ? 'weiblich' : v === 'm' ? 'männlich' : '') },
  { key: 'birth_date', label: 'Geburtsdatum', format: (v) => fmtDate(v as string | null) },
  { key: 'status', label: 'Status' },
  { key: 'entry_date', label: 'Zugang', format: (v) => fmtDate(v as string | null) },
  { key: 'exit_date', label: 'Abgang', format: (v) => fmtDate(v as string | null) },
  { key: 'milk_test_count', label: 'Milchtests' },
  { key: 'notes', label: 'Bemerkung' },
]
const DEFAULT_COLUMNS: (keyof AnimalRow)[] = ['name', 'ear_tag', 'breed_code', 'birth_date', 'status', 'milk_test_count']

function cellText(col: (typeof COLUMNS)[number], row: AnimalRow): string {
  const v = row[col.key]
  if (col.format) return col.format(v)
  return v == null ? '' : String(v)
}

function loadColumns(storageKey: string): (keyof AnimalRow)[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      const valid = parsed.filter((k) => COLUMNS.some((c) => c.key === k)) as (keyof AnimalRow)[]
      if (valid.length > 0) return valid
    }
  } catch {
    // localStorage nicht verfügbar → Defaults
  }
  return DEFAULT_COLUMNS
}

/** Filtert über ALLE Spalten (nicht nur die angezeigten): jedes Wort muss irgendwo vorkommen. */
export function matchesFilter(row: AnimalRow, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = COLUMNS.map((c) => cellText(c, row))
    .join(' ')
    .toLowerCase()
  return words.every((w) => haystack.includes(w))
}

export default function AnimalTable({ animals, storageKey }: { animals: AnimalRow[]; storageKey: string }) {
  const [columns, setColumns] = useState<(keyof AnimalRow)[]>(() => loadColumns(storageKey))
  const [sortKey, setSortKey] = useState<keyof AnimalRow>('name')
  const [sortDesc, setSortDesc] = useState(false)

  function toggleColumn(key: keyof AnimalRow) {
    setColumns((cols) => {
      // Reihenfolge immer wie in COLUMNS, egal in welcher Reihenfolge angeklickt
      const next = cols.includes(key)
        ? cols.filter((c) => c !== key)
        : COLUMNS.filter((c) => cols.includes(c.key) || c.key === key).map((c) => c.key)
      if (next.length === 0) return cols
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // egal — gilt dann nur bis zum Reload
      }
      return next
    })
  }

  const sorted = useMemo(() => {
    const copy = [...animals]
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp =
        typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'de-CH')
      return sortDesc ? -cmp : cmp
    })
    return copy
  }, [animals, sortKey, sortDesc])

  function handleSort(key: keyof AnimalRow) {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(false)
    }
  }

  const visible = COLUMNS.filter((c) => columns.includes(c.key))

  return (
    <div className="space-y-2">
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer select-none">
          Spalten ({visible.length} von {COLUMNS.length})
        </summary>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 rounded bg-white p-2 shadow-sm">
          {COLUMNS.map((c) => (
            <label key={c.key} className="flex items-center gap-1">
              <input type="checkbox" checked={columns.includes(c.key)} onChange={() => toggleColumn(c.key)} className="h-3.5 w-3.5" />
              {c.label}
            </label>
          ))}
        </div>
      </details>
      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              {visible.map((c) => (
                <th
                  key={c.key}
                  onClick={() => handleSort(c.key)}
                  className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 font-medium active:bg-gray-100 ${
                    sortKey === c.key ? 'text-brand-700' : ''
                  }`}
                >
                  {c.label}
                  {sortKey === c.key ? (sortDesc ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <tr key={a.id} className={`border-b last:border-0 ${a.status !== 'aktiv' ? 'text-gray-400' : ''}`}>
                {visible.map((c) => (
                  <td
                    key={c.key}
                    className={`whitespace-nowrap px-3 py-1.5 ${c.key === 'name' || c.key === 'ear_tag' ? 'font-medium text-gray-800' : ''}`}
                  >
                    {c.key === 'status' ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.status === 'aktiv' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {a.status}
                      </span>
                    ) : (
                      cellText(c, a) || '–'
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={visible.length} className="px-3 py-4 text-center text-gray-400">
                  Keine Treffer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
