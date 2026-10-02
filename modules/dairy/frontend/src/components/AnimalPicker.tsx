import { useMemo, useState } from 'react'
import type { Animal } from '../types'
import { animalLabel } from '@fmis/core/earTag'

/** Tierauswahl per Laufnummer, Name oder Ohrmarke — für die Erfassungs-
 * formulare. Mit `multiple` mehrere Tiere (z.B. eine Belegperiode für die
 * ganze Gruppe). */
export default function AnimalPicker({
  animals,
  selected,
  onChange,
  multiple = false,
  placeholder = 'Laufnummer, Name oder Ohrmarke',
}: {
  animals: Animal[]
  selected: string[]
  onChange: (ids: string[]) => void
  multiple?: boolean
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(animals.map((a) => [a.id, a])), [animals])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return animals
      .filter((a) => !selected.includes(a.id))
      .map((a) => {
        const nr = (a.lauf_nr ?? '').toLowerCase()
        const score = nr === q ? 0 : nr.startsWith(q) ? 1 : (a.name ?? '').toLowerCase().includes(q) ? 2 : a.ear_tag.toLowerCase().includes(q.replace(/[.\s]/g, '')) ? 3 : 9
        return { a, score }
      })
      .filter((m) => m.score < 9)
      .sort((x, y) => x.score - y.score || (x.a.lauf_nr ?? '').localeCompare(y.a.lauf_nr ?? ''))
      .slice(0, 8)
      .map((m) => m.a)
  }, [animals, query, selected])

  function pick(id: string) {
    onChange(multiple ? [...selected, id] : [id])
    setQuery('')
  }

  const label = (a: Animal) => `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${animalLabel(a)}`

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => {
            const a = byId.get(id)
            return (
              <span key={id} className="flex items-center gap-1 rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-900">
                {a ? label(a) : id}
                <button
                  type="button"
                  onClick={() => onChange(selected.filter((x) => x !== id))}
                  className="text-brand-700"
                  aria-label="entfernen"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
      {(multiple || selected.length === 0) && (
        <>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) {
                e.preventDefault()
                pick(matches[0].id)
              }
            }}
            placeholder={placeholder}
            inputMode="search"
            className="w-full rounded-lg border border-gray-300 px-3 py-3 text-base"
          />
          {matches.length > 0 && (
            <ul className="mt-1 divide-y rounded-lg border border-gray-200 bg-white">
              {matches.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => pick(a.id)} className="w-full px-3 py-2.5 text-left active:bg-gray-50">
                    <span className="font-semibold text-gray-800">{label(a)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
