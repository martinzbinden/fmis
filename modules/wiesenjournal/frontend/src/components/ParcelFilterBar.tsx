import { useMemo, useRef, useState } from 'react'
import type { Parcel } from '../types'
import { VIRTUAL_CATEGORY_LABEL, matchesVirtualCategory, type FilterChip, type VirtualCategory } from '../lib/parcelFilter'

interface Suggestion {
  value: string
  kind: FilterChip['kind']
  label: string
}

const KIND_LABEL: Record<FilterChip['kind'], string> = { name: 'Parzelle', kultur: 'Kultur', category: 'Kategorie' }

/** Freitext-Filter mit Autovervollständigung (Parzellennamen, Kulturen und
 * virtuelle Überkategorien wie "Wiesen"/"Weiden"/"BFF") — Tippen filtert
 * sofort live, ein Klick auf einen Vorschlag legt zusätzlich einen
 * entfernbaren Filter-Knopf an (mehrere Knöpfe = Treffer, die auf
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
  chips: FilterChip[]
  onChipsChange: (chips: FilterChip[]) => void
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
    const categories = (Object.keys(VIRTUAL_CATEGORY_LABEL) as VirtualCategory[])
      .filter((c) => parcels.some((p) => matchesVirtualCategory(p, c)))
      .map((c): Suggestion => ({ value: c, kind: 'category', label: VIRTUAL_CATEGORY_LABEL[c] }))
    const all: Suggestion[] = [
      ...categories,
      ...[...names].sort().map((value): Suggestion => ({ value, kind: 'name', label: value })),
      ...[...kulturen].sort().map((value): Suggestion => ({ value, kind: 'kultur', label: value })),
    ]
    const isChipped = (s: Suggestion) => chips.some((c) => c.kind === s.kind && c.value === s.value)
    const q = search.trim().toLowerCase()
    const filtered = q ? all.filter((s) => s.label.toLowerCase().includes(q) && !isChipped(s)) : all.filter((s) => !isChipped(s))
    return filtered.slice(0, 14)
  }, [parcels, search, chips])

  function addChip(s: Suggestion) {
    onChipsChange([...chips, { value: s.value, kind: s.kind }])
    onSearchChange('')
    setOpen(false)
    inputRef.current?.focus()
  }
  function removeChip(chip: FilterChip) {
    onChipsChange(chips.filter((c) => !(c.kind === chip.kind && c.value === chip.value)))
  }
  function chipLabel(chip: FilterChip): string {
    return chip.kind === 'category' ? VIRTUAL_CATEGORY_LABEL[chip.value as VirtualCategory] : chip.value
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span
          key={`${c.kind}-${c.value}`}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            c.kind === 'category' ? 'bg-teal-100 text-teal-800' : 'bg-brand-100 text-brand-800'
          }`}
        >
          {chipLabel(c)}
          <button type="button" onClick={() => removeChip(c)} aria-label={`Filter "${chipLabel(c)}" entfernen`} className="leading-none">
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
          placeholder="Parzelle, Kultur oder Kategorie…"
          className="w-48 rounded border border-gray-300 px-2 py-1 text-xs"
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute left-0 top-full z-40 mt-1 max-h-64 w-56 overflow-y-auto rounded border border-gray-200 bg-white py-1 text-xs shadow-lg">
            {suggestions.map((s) => (
              <li key={`${s.kind}-${s.value}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addChip(s)}
                  className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-gray-50"
                >
                  <span className="truncate">{s.label}</span>
                  <span className={`shrink-0 text-[10px] ${s.kind === 'category' ? 'font-medium text-teal-600' : 'text-gray-400'}`}>
                    {KIND_LABEL[s.kind]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
