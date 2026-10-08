import { useEffect, useState } from 'react'
import { useDb } from '@fmis/core/DbContext'
import { useQuery } from '../hooks/useQuery'
import TreatmentItems, { emptyItem } from './TreatmentItems'
import { localTodayIso } from '../lib/format'
import { loadTreatmentContext, saveTemplate, saveTreatment } from '../lib/treatmentData'
import { DEFAULT_WITHDRAWAL_FACTOR, parseItems } from '../lib/treatments'
import type { TemplateItem, TreatmentTemplate } from '../types'

const LS = { by: 'dairy_journal_last_administered_by', supplier: 'dairy_treatment_supplier' }
const load = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const store = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    // nur Komfort
  }
}
const nowTime = () => new Date().toTimeString().slice(0, 5)

/** Behandlung erfassen (Behandlungsjournal nach TAMV): Favorit wählen oder
 * frei, Indikation, Präparate mit Menge und Absetzfristen, Uhrzeit,
 * anwendende Person, Abgabestelle. Mehrere Tiere = je Tier ein Fall. */
export default function TreatmentForm({ animalIds, onSaved }: { animalIds: string[]; onSaved: () => void }) {
  const db = useDb()
  const { data: ctx } = useQuery(loadTreatmentContext)
  const [date, setDate] = useState(localTodayIso)
  const [time, setTime] = useState(nowTime)
  const [diagnosis, setDiagnosis] = useState('')
  const [bodySystem, setBodySystem] = useState('')
  const [items, setItems] = useState<TemplateItem[]>([emptyItem()])
  const [by, setBy] = useState(() => load(LS.by) ?? '')
  const [supplier, setSupplier] = useState(() => load(LS.supplier) ?? '')
  // Bio: immer verdoppelt vorbelegt, je Behandlung abwählbar (bewusst nicht gemerkt)
  const [factor, setFactor] = useState(DEFAULT_WITHDRAWAL_FACTOR)
  const [notes, setNotes] = useState('')
  const [favorite, setFavorite] = useState<{ on: boolean; title: string }>({ on: false, title: '' })
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const f = factor

  useEffect(() => {
    if (!by && ctx?.persons[0]) setBy(ctx.persons[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx])

  function applyTemplate(t: TreatmentTemplate) {
    setTemplateId(t.id)
    setDiagnosis(t.diagnosis ?? t.title)
    setBodySystem(t.body_system ?? '')
    if (t.supplier) setSupplier(t.supplier)
    const its = parseItems(t.items)
    setItems(its.length ? its.map((i) => ({ ...i })) : [emptyItem()])
    if (t.notes) setNotes(t.notes)
  }

  async function save() {
    if (animalIds.length === 0) return setError('Zuerst ein Tier wählen.')
    if (!diagnosis.trim()) return setError('Indikation / Befund angeben (Pflicht im Behandlungsjournal).')
    const missing = items.find((i) => i.hint && !i.medication.trim())
    if (missing) return setError(`${missing.hint} — Präparat angeben.`)
    const used = items.filter((i) => i.medication.trim())
    if (used.length === 0) return setError('Mindestens ein Präparat angeben.')
    if (used.some((i) => i.milk_days == null || i.meat_days == null))
      return setError('Absetzfristen Milch und Fleisch angeben (0 = keine) — laut Packungsbeilage bzw. Tierarzt.')
    if (!by.trim()) return setError('Wer hat behandelt? (Pflicht im Behandlungsjournal)')
    setSaving(true)
    setError(null)
    try {
      await saveTreatment(db, {
        animalIds,
        date,
        time: time || null,
        body_system: bodySystem.trim() || null,
        diagnosis: diagnosis.trim(),
        items: used,
        administered_by: by.trim(),
        supplier: supplier.trim() || null,
        factor: f,
        notes: notes.trim() || null,
      })
      if (favorite.on && favorite.title.trim())
        await saveTemplate(db, {
          id: crypto.randomUUID(),
          title: favorite.title.trim(),
          body_system: bodySystem.trim() || null,
          diagnosis: diagnosis.trim(),
          items: JSON.stringify(used.map((i) => ({ ...i, hint: undefined }))),
          supplier: supplier.trim() || null,
          notes: null,
          sort_order: (ctx?.templates.length ?? 0) * 10 + 10,
        })
      store(LS.by, by.trim())
      if (supplier.trim()) store(LS.supplier, supplier.trim())
      setFactor(DEFAULT_WITHDRAWAL_FACTOR)
      setDiagnosis('')
      setBodySystem('')
      setItems([emptyItem()])
      setNotes('')
      setTemplateId(null)
      setFavorite({ on: false, title: '' })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base'
  return (
    <div className="space-y-3">
      {ctx && ctx.templates.length > 0 && (
        <div>
          <div className="mb-1 text-sm text-gray-600">Favoriten</div>
          <div className="flex flex-wrap gap-1.5">
            {ctx.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className={`rounded-full px-3 py-1.5 text-sm ${templateId === t.id ? 'bg-brand-700 text-white' : 'border border-brand-200 bg-brand-50 text-brand-800'}`}
              >
                ★ {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm text-gray-600">
          Datum (1. Anwendung)
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="block text-sm text-gray-600">
          Uhrzeit
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
        </label>
      </div>
      <label className="block text-sm text-gray-600">
        Indikation / Befund
        <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="z.B. Fieber 40 °C, Verdacht Blauzunge" className={input} />
      </label>
      <label className="block text-sm text-gray-600">
        Organ / Position (optional)
        <input value={bodySystem} onChange={(e) => setBodySystem(e.target.value)} placeholder="z.B. Klaue VR, Euter HL" className={input} />
      </label>
      <TreatmentItems items={items} onChange={setItems} known={ctx?.medications ?? []} date={date} factor={f} />
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={f === 2} onChange={(e) => setFactor(e.target.checked ? 2 : 1)} className="h-4 w-4" />
        Absetzfristen verdoppeln (Bio)
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm text-gray-600">
          Behandelt durch
          <input list="dairy-persons" value={by} onChange={(e) => setBy(e.target.value)} className={input} />
        </label>
        <label className="block text-sm text-gray-600">
          Abgabestelle (Tierarzt)
          <input list="dairy-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={input} />
        </label>
      </div>
      <datalist id="dairy-persons">
        {(ctx?.persons ?? []).map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="dairy-suppliers">
        {(ctx?.suppliers ?? []).map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <label className="block text-sm text-gray-600">
        Bemerkung (optional)
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={input} />
      </label>
      <div className="rounded-lg border border-gray-200 p-2 text-sm">
        <label className="flex items-center gap-2 text-gray-700">
          <input type="checkbox" checked={favorite.on} onChange={(e) => setFavorite({ on: e.target.checked, title: favorite.title || diagnosis })} className="h-4 w-4" />
          Als Favorit speichern
        </label>
        {favorite.on && (
          <input value={favorite.title} onChange={(e) => setFavorite({ ...favorite, title: e.target.value })} placeholder="Name des Favoriten" className={`${input} mt-2`} />
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || animalIds.length === 0}
        className="w-full rounded-lg bg-brand-700 py-3 text-base font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Speichere…' : animalIds.length > 1 ? `Behandlung für ${animalIds.length} Tiere speichern` : 'Behandlung speichern'}
      </button>
    </div>
  )
}
