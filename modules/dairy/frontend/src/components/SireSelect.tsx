import { useState } from 'react'
import { animalKey } from '../lib/animalId'
import { sireLabel, type SireOption } from '../lib/sires'

export interface SireValue {
  key: string | null
  ear_tag: string
  name: string
}

export const EMPTY_SIRE: SireValue = { key: null, ear_tag: '', name: '' }

/** Vatertier wählen: bekannte Widder/Stiere aus der Liste oder ein anderes
 * Tier per Ohrmarke/Name. */
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
  const [other, setOther] = useState(false)
  const selectValue = other ? '__other' : (known?.key ?? '')
  const input = 'w-full rounded-lg border border-gray-300 px-3 py-3 text-base'
  return (
    <div className="space-y-2">
      <label className="block text-sm text-gray-600">
        {label}
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value
            setOther(v === '__other')
            if (v === '' || v === '__other') onChange(EMPTY_SIRE)
            else {
              const o = options.find((x) => x.key === v)!
              onChange({ key: o.key, ear_tag: o.ear_tag, name: o.name ?? '' })
            }
          }}
          className={input}
        >
          <option value="">unbekannt</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {sireLabel(o)}
            </option>
          ))}
          <option value="__other">Anderes Tier…</option>
        </select>
      </label>
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
