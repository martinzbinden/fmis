import { useMemo, useState, type ReactNode } from 'react'
import AnimalOption from '@fmis/core/AnimalOption'
import { animalKey } from '@fmis/core/earTag'
import { fmtDate } from '../lib/format'
import type { SireOption } from '../lib/sires'

export interface SireValue {
  key: string | null
  ear_tag: string
  name: string
}

export const EMPTY_SIRE: SireValue = { key: null, ear_tag: '', name: '' }

/** Vatertier wählen: bekannte Widder/Stiere als Klappliste mit Suchfeld (Ohrmarke, Laufnummer, Name; zuletzt
 * eingesetzte zuerst) oder ein anderes Tier per Ohrmarke/Name. `children` erscheint gleich unter der Auswahl. */
export default function SireSelect({
  options,
  value,
  onChange,
  label,
  children,
}: {
  options: SireOption[]
  value: SireValue
  onChange: (v: SireValue) => void
  label: string
  children?: ReactNode
}) {
  const known = value.key ? options.find((o) => o.key === value.key) : undefined
  const [otherChosen, setOther] = useState(false)
  // vorbelegter Vater, der nicht in der Liste steht (z.B. aus einer Belegung) → als «anderes Tier» zeigen
  const other = otherChosen || (!known && !!(value.ear_tag || value.name))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    const qt = q.replace(/[.\s]/g, '')
    return options.filter((o) => (o.lauf_nr ?? '').toLowerCase().startsWith(q) || (o.name ?? '').toLowerCase().includes(q) || o.ear_tag.toLowerCase().replace(/[.\s]/g, '').includes(qt))
  }, [options, query])
  function choose(o: SireOption) {
    setOther(false)
    setOpen(false)
    setQuery('')
    onChange({ key: o.key, ear_tag: o.ear_tag, name: o.name ?? '' })
  }
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-3 text-base'
  const chip = (active: boolean) => `min-h-11 rounded-lg border px-3 text-sm ${active ? 'border-brand-700 bg-brand-50 font-semibold text-brand-900' : 'border-gray-300 text-gray-700'}`
  return (
    <div className="space-y-2">
      <div className="text-sm text-gray-600">{label}</div>
      {options.length > 0 && (
        <div className="rounded-lg border border-gray-300 bg-white">
          <button
            type="button"
            onClick={() => {
              setOpen((o) => !o)
              setQuery('')
            }}
            aria-expanded={open}
            aria-haspopup="listbox"
            className="flex min-h-12 w-full items-center gap-2 px-3 text-left"
          >
            {known && !other ? (
              <AnimalOption animal={{ ...known, sex: 'm' }} extra={known.lastUsed ? <span className="text-gray-500">zuletzt {fmtDate(known.lastUsed)}</span> : undefined} />
            ) : (
              <span className="flex-1 text-gray-600">{other ? 'Anderes Tier (unten)' : value.ear_tag || value.name ? 'anderes Tier' : `${label} wählen …`}</span>
            )}
            <span aria-hidden className="shrink-0 text-gray-500">
              {open ? '▴' : '▾'}
            </span>
          </button>
          {open && (
            <div className="border-t border-gray-200 p-2">
              {options.length > 0 && (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && shown[0]) {
                      e.preventDefault()
                      choose(shown[0])
                    }
                  }}
                  autoFocus
                  placeholder="Suchen: Nummer, Name, Ohrmarke"
                  aria-label={`${label} suchen`}
                  className="mb-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base"
                />
              )}
              <ul className="max-h-64 divide-y overflow-y-auto" role="listbox" aria-label={label}>
                {shown.map((o) => {
                  const active = !other && known?.key === o.key
                  return (
                    <li key={o.key} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => choose(o)}
                        className={`flex min-h-12 w-full items-center gap-2 px-2 text-left ${active ? 'bg-brand-50 ring-2 ring-inset ring-brand-700' : 'active:bg-gray-50'}`}
                      >
                        <AnimalOption
                          animal={{ ...o, sex: 'm' }}
                          extra={
                            <>
                              {o.lastUsed && <span className="text-gray-500">zuletzt {fmtDate(o.lastUsed)}</span>}
                              {!o.present && <span className="rounded bg-gray-100 px-1 text-gray-600">nicht im Bestand</span>}
                            </>
                          }
                        />
                      </button>
                    </li>
                  )
                })}
                {shown.length === 0 && <li className="px-2 py-2 text-sm text-gray-600">Kein Tier mit «{query.trim()}».</li>}
              </ul>
            </div>
          )}
        </div>
      )}
      {children}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setOther(false)
            setOpen(false)
            onChange(EMPTY_SIRE)
          }}
          className={chip(!other && !known && !value.ear_tag)}
        >
          unbekannt
        </button>
        <button
          type="button"
          onClick={() => {
            setOther(true)
            setOpen(false)
            onChange(EMPTY_SIRE)
          }}
          className={chip(other)}
        >
          Anderes Tier…
        </button>
      </div>
      {other && (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={value.ear_tag}
            onChange={(e) => onChange({ ...value, ear_tag: e.target.value, key: animalKey(e.target.value) })}
            placeholder="Ohrmarke / ID"
            className={input}
          />
          <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Name" className={input} />
        </div>
      )}
    </div>
  )
}
