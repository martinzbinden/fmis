import { useState } from 'react'
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

/** Vatertier wählen: bekannte Widder/Stiere als Liste (Ohrmarke, Laufnummer,
 * Geburtsdatum) oder ein anderes Tier per Ohrmarke/Name. */
export default function SireSelect({
  options,
  value,
  onChange,
  label,
}: {
  options: SireOption[]
  value: SireValue
  onChange: (v: SireValue) => void
  label: string
}) {
  const known = value.key ? options.find((o) => o.key === value.key) : undefined
  const [otherChosen, setOther] = useState(false)
  // vorbelegter Vater, der nicht in der Liste steht (z.B. aus einer Belegung) → als «anderes Tier» zeigen
  const other = otherChosen || (!known && !!(value.ear_tag || value.name))
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-3 text-base'
  const chip = (active: boolean) => `min-h-10 rounded-lg border px-3 text-sm ${active ? 'border-brand-700 bg-brand-50 font-semibold text-brand-900' : 'border-gray-300 text-gray-700'}`
  return (
    <div className="space-y-2">
      <div className="text-sm text-gray-600">{label}</div>
      {options.length > 0 && (
        <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border border-gray-300 bg-white" role="radiogroup" aria-label={label}>
          {options.map((o) => {
            const active = !other && known?.key === o.key
            return (
              <li key={o.key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setOther(false)
                    onChange({ key: o.key, ear_tag: o.ear_tag, name: o.name ?? '' })
                  }}
                  className={`flex min-h-12 w-full items-center gap-2 px-3 text-left ${active ? 'bg-brand-50 ring-2 ring-inset ring-brand-700' : 'active:bg-gray-50'}`}
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
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setOther(false)
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
