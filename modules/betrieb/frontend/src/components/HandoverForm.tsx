import { useState, type ReactNode } from 'react'
import { addDaysIso, todayIso } from '../lib/format'
import { HANDOVER_TEMPLATES, saveHandoverItem, type HandoverTarget } from '../lib/handover'

const field = 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-base'

/** Neuer Übergabe-Punkt: was (Vorlagen oder frei), für welche Tiere (Wähler kommt von der Seite, z.B. Stall mit
 * Jungtieren ohne Ohrmarke), für welchen Dienst, einmal oder bei jedem Dienst bis … */
export default function HandoverForm({
  types,
  animal,
  defaultTypeId = '',
  renderTargets,
  onSaved,
  onCancel,
}: {
  /** Dienste zur Auswahl (bereits nach Tierart gefiltert) */
  types: { id: string; label: string }[]
  /** Tierart der Seite (wie duty_types.animal), gilt für «jeder Dienst» */
  animal: string | null
  defaultTypeId?: string
  renderTargets?: (targets: HandoverTarget[], setTargets: (t: HandoverTarget[]) => void) => ReactNode
  onSaved: () => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [targets, setTargets] = useState<HandoverTarget[]>([])
  const [typeId, setTypeId] = useState(defaultTypeId)
  const [recurring, setRecurring] = useState(false)
  const [until, setUntil] = useState(addDaysIso(todayIso(), 7))
  const [busy, setBusy] = useState(false)
  const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-sm ${on ? 'border-brand-700 bg-brand-50 font-semibold text-brand-900' : 'border-gray-300 bg-white text-gray-700'}`
  async function save() {
    if (!text.trim()) return
    setBusy(true)
    try {
      await saveHandoverItem({ text, targets, type_id: typeId || null, animal, from_date: todayIso(), until_date: recurring ? until || null : null, recurring })
      onSaved()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 rounded-xl border-2 border-amber-300 bg-white p-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {HANDOVER_TEMPLATES.map((t) => (
          <button key={t} type="button" className={chip(text === t)} onClick={() => setText(t)}>
            {t}
          </button>
        ))}
      </div>
      <input className={`${field} w-full`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Was ist zu tun / zu beachten?" aria-label="Übergabe-Punkt" />
      {renderTargets?.(targets, setTargets)}
      <label className="block">
        <span className="text-gray-600">Für</span>
        <select className={`${field} w-full`} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          <option value="">jeden Dienst{animal ? ` (${animal})` : ''}</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={chip(!recurring)} onClick={() => setRecurring(false)}>
          einmal (nächster Dienst)
        </button>
        <button type="button" className={chip(recurring)} onClick={() => setRecurring(true)}>
          jeder Dienst bis …
        </button>
        {recurring && <input type="date" className={field} value={until} min={todayIso()} onChange={(e) => setUntil(e.target.value)} aria-label="bis" />}
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !text.trim()} onClick={() => void save()} className="min-h-12 flex-1 rounded-lg bg-amber-600 font-semibold text-white disabled:opacity-40">
          Übergabe speichern
        </button>
        <button type="button" onClick={onCancel} className="min-h-12 rounded-lg border border-gray-300 px-3">
          Abbrechen
        </button>
      </div>
    </div>
  )
}
