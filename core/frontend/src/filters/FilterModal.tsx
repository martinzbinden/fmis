import { useMemo, useState } from 'react'
import Modal from '../Modal'
import {
  FILTER_COLORS,
  OPS_BY_TYPE,
  OP_LABEL,
  blankCondition,
  conditionComplete,
  countMatches,
  opInputs,
  retargetCondition,
  type Condition,
  type EvalContext,
  type FieldDef,
  type FilterDef,
} from './filterModel'

const input = 'min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base'

/** Filter bauen oder ändern: Name, Farbe, Bedingungen («alle» oder «eine davon»). Zeigt sofort,
 * auf wie viele Zeilen er zutrifft. Vorlagen lassen sich nur als Kopie ändern. */
export default function FilterModal<R>({
  fields,
  rows,
  ctx,
  initial,
  onSave,
  onDelete,
  onClose,
}: {
  fields: FieldDef<R>[]
  rows: R[]
  ctx: EvalContext
  initial?: FilterDef
  onSave: (f: FilterDef) => void
  onDelete?: () => void
  onClose: () => void
}) {
  const copy = !!initial?.preset
  const [name, setName] = useState(initial ? (copy ? `${initial.name} (Kopie)` : initial.name) : '')
  const [color, setColor] = useState(initial?.color ?? 'blau')
  const [match, setMatch] = useState<'all' | 'any'>(initial?.match ?? 'all')
  const [conditions, setConditions] = useState<Condition[]>(initial?.conditions.length ? initial.conditions.map((c) => ({ ...c })) : [blankCondition(fields[0])])

  const groups = useMemo(() => {
    const out = new Map<string, FieldDef<R>[]>()
    for (const f of fields) out.set(f.group ?? '', [...(out.get(f.group ?? '') ?? []), f])
    return [...out.entries()]
  }, [fields])

  const draft: FilterDef = { id: initial && !copy ? initial.id : crypto.randomUUID(), name: name.trim(), color, match, conditions }
  const complete = conditions.length > 0 && conditions.every(conditionComplete)
  const hits = complete ? countMatches(rows, draft, fields, ctx) : null

  const setCond = (i: number, c: Condition) => setConditions((cs) => cs.map((x, j) => (j === i ? c : x)))

  function save() {
    if (!name.trim() || !complete) return
    onSave(draft)
  }

  return (
    <Modal title={initial && !copy ? 'Filter bearbeiten' : 'Neuer Filter'} onClose={onClose} onSubmit={save}>
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Alte, nicht trächtige Auen" className={input} />
        </label>

        <div>
          <span className="mb-1 block font-medium text-gray-700">Farbe</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Farbe">
            {FILTER_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={color === c.key}
                aria-label={c.label}
                onClick={() => setColor(c.key)}
                className={`grid h-11 w-11 place-items-center rounded-full border-2 ${color === c.key ? 'border-gray-900' : 'border-transparent'}`}
              >
                <span className={`h-7 w-7 rounded-full ${c.dot}`} />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-gray-700">Ein Tier trifft zu, wenn</span>
            <select value={match} onChange={(e) => setMatch(e.target.value as 'all' | 'any')} className="min-h-11 rounded-lg border border-gray-300 bg-white px-2" aria-label="Verknüpfung">
              <option value="all">alle Bedingungen</option>
              <option value="any">mindestens eine Bedingung</option>
            </select>
            <span className="text-gray-700">stimmen:</span>
          </div>

          {conditions.map((c, i) => {
            const field = fields.find((f) => f.key === c.field) ?? fields[0]
            return (
              <div key={i} className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                <div className="flex gap-2">
                  <select
                    value={c.field}
                    onChange={(e) => setCond(i, retargetCondition(c, fields.find((f) => f.key === e.target.value) ?? fields[0]))}
                    className={input}
                    aria-label="Feld"
                  >
                    {groups.map(([g, list]) =>
                      g ? (
                        <optgroup key={g} label={g}>
                          {list.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </optgroup>
                      ) : (
                        list.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))
                      ),
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => setConditions((cs) => cs.filter((_, j) => j !== i))}
                    disabled={conditions.length === 1}
                    aria-label="Bedingung entfernen"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-gray-300 bg-white text-lg disabled:opacity-40"
                  >
                    🗑
                  </button>
                </div>
                <select value={c.op} onChange={(e) => setCond(i, { field: c.field, op: e.target.value as Condition['op'] })} className={input} aria-label="Bedingung">
                  {OPS_BY_TYPE[field.type].map((op) => (
                    <option key={op} value={op}>
                      {OP_LABEL[op]}
                    </option>
                  ))}
                </select>
                <ValueInputs field={field} c={c} onChange={(next) => setCond(i, next)} />
              </div>
            )
          })}

          <button type="button" onClick={() => setConditions((cs) => [...cs, blankCondition(fields[0])])} className="min-h-11 rounded-lg border border-dashed border-gray-400 px-3 text-gray-700">
            + Bedingung
          </button>
        </div>

        <p className={`rounded-lg p-2 ${hits == null ? 'bg-amber-50 text-amber-900' : 'bg-sky-50 text-sky-900'}`} aria-live="polite">
          {hits == null ? 'Bedingungen noch unvollständig.' : `Trifft auf ${hits} von ${rows.length} zu.`}
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!name.trim() || !complete} onClick={save} className="min-h-12 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
            Speichern
          </button>
          {onDelete && initial && !copy && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Filter «${initial.name}» löschen?`)) onDelete()
              }}
              className="min-h-12 rounded-lg border border-red-300 px-4 font-medium text-red-700"
            >
              Löschen
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ValueInputs<R>({ field, c, onChange }: { field: FieldDef<R>; c: Condition; onChange: (c: Condition) => void }) {
  const kind = opInputs(c.op)
  if (kind === 'none') return null
  if (kind === 'choice') {
    const chosen = new Set(c.values ?? [])
    return (
      <div className="flex flex-wrap gap-2">
        {(field.options ?? []).map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={chosen.has(o.value)}
            onClick={() => {
              const next = new Set(chosen)
              if (next.has(o.value)) next.delete(o.value)
              else next.add(o.value)
              onChange({ ...c, values: [...next] })
            }}
            className={`min-h-11 rounded-full border px-3 ${chosen.has(o.value) ? 'border-brand-700 bg-brand-700 font-semibold text-white' : 'border-gray-300 bg-white text-gray-800'}`}
          >
            {o.label}
          </button>
        ))}
        {(field.options ?? []).length === 0 && <span className="text-gray-500">Keine Werte vorhanden.</span>}
      </div>
    )
  }
  const days = c.op === 'older_days' || c.op === 'within_days' || c.op === 'next_days'
  const type = field.type === 'date' && !days ? 'date' : 'text'
  const mode = field.type === 'number' || days ? 'decimal' : 'text'
  return (
    <div className="flex items-center gap-2">
      <input
        type={type}
        inputMode={type === 'text' ? mode : undefined}
        value={c.value ?? ''}
        onChange={(e) => onChange({ ...c, value: e.target.value })}
        className={input}
        aria-label={kind === 'two' ? 'von' : 'Wert'}
      />
      {kind === 'two' && (
        <>
          <span className="text-gray-600">und</span>
          <input type={type} inputMode={type === 'text' ? mode : undefined} value={c.value2 ?? ''} onChange={(e) => onChange({ ...c, value2: e.target.value })} className={input} aria-label="bis" />
        </>
      )}
      {(days || (field.type === 'number' && field.unit)) && <span className="shrink-0 text-gray-600">{days ? 'Tage' : field.unit}</span>}
    </div>
  )
}
