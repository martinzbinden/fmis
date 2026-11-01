import { useLocation } from 'react-router-dom'
import { diagnosisByKey, groupsFor } from '../lib/diagnoses'
import { speciesOf } from '../lib/species'

/** Diagnose aus der Kurzliste (lib/diagnoses.ts, mit ICAR-Code). Wählt man eine,
 * füllt das Formular den Befund-Text vor, solange dort nichts Eigenes steht. */
export default function DiagnosisSelect({ value, onChange, className }: { value: string | null; onChange: (key: string | null, label: string | null) => void; className: string }) {
  const species = speciesOf(useLocation().pathname.split('/')[1] ?? '')
  const current = diagnosisByKey(value)
  return (
    <label className="block text-sm text-gray-600">
      Diagnose (Liste)
      <select
        value={value ?? ''}
        onChange={(e) => {
          const d = diagnosisByKey(e.target.value)
          onChange(d?.key ?? null, d?.label ?? null)
        }}
        className={`${className} bg-white`}
      >
        <option value="">– frei formuliert –</option>
        {groupsFor(species).map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {current?.hint && <span className="mt-1 block text-xs text-gray-600">{current.hint}</span>}
    </label>
  )
}
