import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Modal from '../Modal'
import { colorOf, FILTER_COLORS } from '../filters/filterModel'
import { parseQuery, type QueryField } from './engine'
import { addFormula, formulaActive, removeFormula, type QueryPreset } from './presets'

type Edit = Pick<QueryPreset, 'name' | 'short' | 'formula' | 'color'>

/** Eine Zeile Filtervorschläge (so viele, wie Platz haben), Knopf «mehr…» klappt die übrigen darunter aus. Antippen: aus →
 * einfärben → nur zeigen (Formel steht dann im Suchfeld) → aus. ✏️ ändert den Vorschlag selbst. */
export default function QueryPresets<R, C>({
  presets,
  text,
  onText,
  colored,
  onColored,
  counts,
  fields,
  onEdit,
  onAdd,
  onRemove,
  onReset,
}: {
  presets: QueryPreset[]
  text: string
  onText: (t: string) => void
  colored: Set<string>
  onColored: (id: string, on: boolean) => void
  /** Treffer je Vorschlag (optional) */
  counts?: Record<string, number>
  fields: QueryField<R, C>[]
  onEdit: (id: string, patch: Edit) => void
  onAdd: (p: Edit) => void
  onRemove: (id: string) => void
  onReset: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const [editing, setEditing] = useState<QueryPreset | 'new' | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setOverflow(el.scrollHeight > el.clientHeight + 2 || expanded)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [presets, expanded, counts])
  useEffect(() => {
    if (!expanded) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [expanded])

  function cycle(p: QueryPreset) {
    const only = formulaActive(text, p.formula)
    if (only) onText(removeFormula(text, p.formula))
    else if (colored.has(p.id)) {
      onColored(p.id, false)
      onText(addFormula(text, p.formula))
    } else onColored(p.id, true)
  }

  return (
    <div className="flex items-start gap-2">
      <span className="mt-3 flex shrink-0 items-center gap-1 text-xs font-semibold text-gray-600" title="Filtervorschläge: antippen = einfärben, nochmals = nur diese zeigen (Formel im Suchfeld), nochmals = aus">
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M3 4h14l-5.5 6.5V16l-3 -1.5v-4z" />
        </svg>
        Filter
      </span>
      <div ref={box} className={`flex min-w-0 flex-1 flex-wrap items-center gap-1.5 ${expanded ? '' : 'h-11 overflow-hidden'}`} role="group" aria-label="Filtervorschläge">
        {presets.map((p) => {
          const only = formulaActive(text, p.formula)
          const state = only ? 'only' : colored.has(p.id) ? 'color' : 'off'
          const c = colorOf(p.color)
          const n = counts?.[p.id]
          return (
            <span key={p.id} className="inline-flex shrink-0 items-stretch">
              <button
                type="button"
                onClick={() => cycle(p)}
                title={`${p.name}: ${p.formula} — ${state === 'only' ? 'nur diese zeigen' : state === 'color' ? 'eingefärbt' : 'aus'}. Antippen: ${state === 'off' ? 'einfärben' : state === 'color' ? 'nur diese zeigen' : 'ausschalten'}`}
                aria-label={`${p.name}${n != null ? `, ${n} Treffer` : ''}, ${state === 'only' ? 'nur zeigen' : state === 'color' ? 'eingefärbt' : 'aus'}`}
                aria-pressed={state !== 'off'}
                className={`flex min-h-11 items-center gap-1.5 rounded-l-full border px-2.5 text-sm ${state === 'off' ? 'border-gray-300 bg-white text-gray-700' : `${c.chip} font-semibold`} ${state === 'only' ? 'ring-2 ring-gray-800' : ''}`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.dot}`} aria-hidden />
                {p.short}
                {n != null && <span className="text-xs font-normal opacity-70">{n}</span>}
              </button>
              <button type="button" onClick={() => setEditing(p)} title={`«${p.name}» ändern`} aria-label={`Filtervorschlag ${p.name} ändern`} className={`grid min-h-11 w-8 place-items-center rounded-r-full border border-l-0 text-xs ${state === 'off' ? 'border-gray-300 bg-white text-gray-600' : `${c.chip}`}`}>
                ✏️
              </button>
            </span>
          )
        })}
        <button type="button" onClick={() => setEditing('new')} title="Aktuelle Formel als neuen Filtervorschlag speichern" aria-label="Neuer Filtervorschlag" className="min-h-11 shrink-0 rounded-full border border-dashed border-gray-400 px-3 text-sm text-gray-700 active:bg-gray-100">
          + Vorschlag
        </button>
      </div>
      {overflow && (
        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="mt-0 min-h-11 shrink-0 rounded-lg border-2 border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 active:bg-gray-100">
          {expanded ? 'weniger' : 'mehr…'}
        </button>
      )}
      {editing && (
        <PresetEditor
          preset={editing === 'new' ? null : editing}
          initialFormula={text}
          fields={fields}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            if (editing === 'new') onAdd(patch)
            else onEdit(editing.id, patch)
            setEditing(null)
          }}
          onRemove={editing !== 'new' && !editing.builtin ? () => { onRemove(editing.id); setEditing(null) } : undefined}
          onReset={editing !== 'new' && editing.builtin ? () => { onReset(editing.id); setEditing(null) } : undefined}
        />
      )}
    </div>
  )
}

function PresetEditor<R, C>({
  preset,
  initialFormula,
  fields,
  onClose,
  onSave,
  onRemove,
  onReset,
}: {
  preset: QueryPreset | null
  initialFormula: string
  fields: QueryField<R, C>[]
  onClose: () => void
  onSave: (p: Edit) => void
  onRemove?: () => void
  onReset?: () => void
}) {
  const [name, setName] = useState(preset?.name ?? '')
  const [short, setShort] = useState(preset?.short ?? '')
  const [formula, setFormula] = useState(preset?.formula ?? initialFormula)
  const [color, setColor] = useState(preset?.color ?? 'blau')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const parsed = parseQuery(fields, formula)
  const bad = parsed.errors.length > 0 || parsed.conditions.length === 0
  const ok = name.trim() && short.trim() && formula.trim() && !bad
  const field = 'mt-1 min-h-11 w-full rounded-lg border-2 border-gray-300 px-3 text-base'
  return (
    <Modal title={preset ? `Filtervorschlag «${preset.name}» ändern` : 'Neuer Filtervorschlag'} onClose={onClose} dirty={false}>
      <form
        className="space-y-3 text-sm text-gray-800"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) onSave({ name: name.trim(), short: short.trim(), formula: formula.trim(), color })
        }}
      >
        <label className="block">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={field} />
        </label>
        <label className="block">
          Kurzbezeichnung (auf dem Knopf)
          <input value={short} onChange={(e) => setShort(e.target.value)} maxLength={14} className={field} />
        </label>
        <label className="block">
          Formel
          <input value={formula} onChange={(e) => setFormula(e.target.value)} spellCheck={false} placeholder="z.B. ZZ > 200 und leer" className={field} />
        </label>
        <div className="flex flex-wrap gap-1.5 text-xs" aria-live="polite">
          {parsed.conditions.map((c, i) => (
            <span key={i} className="rounded-full bg-sky-100 px-2.5 py-1 font-medium text-sky-900">
              {c.text}
            </span>
          ))}
          {parsed.errors.map((e, i) => (
            <span key={i} className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-900">
              {e.reason}
            </span>
          ))}
          {parsed.conditions.length === 0 && parsed.errors.length === 0 && <span className="text-gray-600">Keine Bedingung erkannt.</span>}
        </div>
        <div>
          Farbe
          <div className="mt-1 flex flex-wrap gap-2">
            {FILTER_COLORS.map((c) => (
              <button key={c.key} type="button" onClick={() => setColor(c.key)} aria-pressed={color === c.key} aria-label={c.label} title={c.label} className={`h-9 w-9 rounded-full border-2 ${c.dot} ${color === c.key ? 'border-gray-900 ring-2 ring-gray-300' : 'border-white'}`} />
            ))}
          </div>
        </div>
        <button type="submit" disabled={!ok} className="min-h-12 w-full rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-50">
          Speichern
        </button>
        {onReset && (
          <button type="button" onClick={onReset} className="min-h-12 w-full rounded-lg border-2 border-gray-400 px-3 font-semibold text-gray-800">
            Vorgabe wiederherstellen
          </button>
        )}
        {onRemove && (confirmRemove ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmRemove(false)} className="min-h-12 flex-1 rounded-lg border-2 border-gray-400 px-3 font-semibold">
              Abbrechen
            </button>
            <button type="button" onClick={onRemove} className="min-h-12 flex-1 rounded-lg bg-red-700 px-3 font-semibold text-white">
              Wirklich löschen
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmRemove(true)} className="min-h-12 w-full rounded-lg border-2 border-red-700 px-3 font-semibold text-red-700">
            Vorschlag löschen …
          </button>
        ))}
      </form>
    </Modal>
  )
}
