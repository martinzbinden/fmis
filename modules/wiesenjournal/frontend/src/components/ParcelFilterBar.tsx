import { useMemo, useRef, useState } from 'react'
import type { Parcel } from '../types'

interface Suggestion {
  value: string
  kind: 'name' | 'kultur'
}

/** Freitext-Filter mit Autovervollständigung (Parzellennamen + Kulturen) —
 * Tippen filtert sofort live, ein Klick auf einen Vorschlag legt zusätzlich
 * einen entfernbaren Filter-Knopf an (mehrere Knöpfe = Treffer, die auf
 * MINDESTENS einen davon passen). */
export default function ParcelFilterBar({
  parcels,
  search,
  onSearchChange,
  chips,
  onChipsChange,
}: {
  parcels: Parcel[]
  search: string
  onSearchChange: (v: string) => void
  chips: string[]
  onChipsChange: (chips: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    const names = new Set<string>()
    const kulturen = new Set<string>()
    for (const p of parcels) {
      names.add(p.name)
      if (p.kultur_name_de) kulturen.add(p.kultur_name_de)
    }
    const all: Suggestion[] = [
      ...[...names].sort().map((value): Suggestion => ({ value, kind: 'name' })),
      ...[...kulturen].sort().map((value): Suggestion => ({ value, kind: 'kultur' })),
    ]
    const q = search.trim().toLowerCase()
    const filtered = q ? all.filter((s) => s.value.toLowerCase().includes(q) && !chips.includes(s.value)) : all.filter((s) => !chips.includes(s.value))
    return filtered.slice(0, 12)
  }, [parcels, search, chips])

  function addChip(value: string) {
    if (!chips.includes(value)) onChipsChange([...chips, value])
    onSearchChange('')
    setOpen(false)
    inputRef.current?.focus()
  }
  function removeChip(value: string) {
    onChipsChange(chips.filter((c) => c !== value))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span key={c} className="flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800">
          {c}
          <button type="button" onClick={() => removeChip(c)} aria-label={`Filter "${c}" entfernen`} className="leading-none text-brand-600">
            ×
          </button>
        </span>
      ))}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            onSearchChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Parzelle oder Kultur…"
          className="w-40 rounded border border-gray-300 px-2 py-1 text-xs"
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute left-0 top-full z-30 mt-1 max-h-56 w-52 overflow-y-auto rounded border border-gray-200 bg-white py-1 text-xs shadow-lg">
            {suggestions.map((s) => (
              <li key={`${s.kind}-${s.value}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addChip(s.value)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-gray-50"
                >
                  <span className="truncate">{s.value}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">{s.kind === 'name' ? 'Parzelle' : 'Kultur'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
