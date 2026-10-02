import { useState } from 'react'
import { useDb } from '@fmis/core/DbContext'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import { JOURNAL_CATEGORIES, journalSummary } from '../lib/journal'
import { localTodayIso } from '../lib/format'
import type { JournalCategory } from '../types'

const LAST_BY_KEY = 'dairy_journal_last_administered_by'

function lastAdministeredBy(): string {
  try {
    return localStorage.getItem(LAST_BY_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Journaleintrag für ein oder mehrere Tiere — Beobachtung, Krankheit,
 * Behandlung (mit Medikament, Dosis und Absetzfristen: deckt das
 * Behandlungsjournal ab), Brunst, Klauen, Notiz. Mehrere Tiere ergeben je
 * einen Eintrag, z.B. Klauenpflege der ganzen Gruppe. */
export default function JournalForm({ animalIds, onSaved }: { animalIds: string[]; onSaved: () => void }) {
  const db = useDb()
  const [date, setDate] = useState(localTodayIso)
  const [category, setCategory] = useState<JournalCategory>('beobachtung')
  const [text, setText] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [medication, setMedication] = useState('')
  const [dose, setDose] = useState('')
  const [milkDays, setMilkDays] = useState('')
  const [meatDays, setMeatDays] = useState('')
  const [administeredBy, setAdministeredBy] = useState(lastAdministeredBy)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isTreatment = category === 'behandlung'
  const hasDiagnosis = category === 'krankheit' || isTreatment
  const intOrNull = (s: string) => (s.trim() === '' ? null : Math.max(0, Number.parseInt(s, 10) || 0))

  async function save() {
    if (animalIds.length === 0) return setError('Zuerst ein Tier wählen.')
    if (isTreatment && !medication.trim()) return setError('Bei einer Behandlung das Medikament angeben.')
    if (!hasDiagnosis && !text.trim()) return setError('Bitte eine Bemerkung erfassen.')
    setSaving(true)
    setError(null)
    try {
      const fields = {
        category,
        diagnosis: hasDiagnosis ? diagnosis.trim() || null : null,
        medication: isTreatment ? medication.trim() || null : null,
        dose: isTreatment ? dose.trim() || null : null,
        withdrawal_milk_days: isTreatment ? intOrNull(milkDays) : null,
        withdrawal_meat_days: isTreatment ? intOrNull(meatDays) : null,
        administered_by: isTreatment ? administeredBy.trim() || null : null,
      }
      await inTransaction(db, async (tx) => {
        for (const animalId of animalIds) {
          await upsertRow(tx, 'animal_journal', {
            id: crypto.randomUUID(),
            animal_id: animalId,
            entry_date: date,
            source: 'manual',
            text: text.trim() || journalSummary(fields),
            ref_id: null,
            ...fields,
          })
        }
      })
      if (isTreatment && administeredBy.trim()) {
        try {
          localStorage.setItem(LAST_BY_KEY, administeredBy.trim())
        } catch {
          // egal
        }
      }
      setText('')
      setDiagnosis('')
      setMedication('')
      setDose('')
      setMilkDays('')
      setMeatDays('')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-3 text-base'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {JOURNAL_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={`rounded-full px-3 py-1.5 text-sm ${category === c.key ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>
      <label className="block text-sm text-gray-600">
        Datum
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
      </label>
      {hasDiagnosis && (
        <label className="block text-sm text-gray-600">
          Diagnose / Befund
          <input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="z.B. Mastitis hinten links" className={input} />
        </label>
      )}
      {isTreatment && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 block text-sm text-gray-600 sm:col-span-1">
              Medikament
              <input value={medication} onChange={(e) => setMedication(e.target.value)} className={input} />
            </label>
            <label className="col-span-2 block text-sm text-gray-600 sm:col-span-1">
              Dosis / Menge
              <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="z.B. 10 ml i.m." className={input} />
            </label>
            <label className="block text-sm text-gray-600">
              Absetzfrist Milch (Tage)
              <input value={milkDays} onChange={(e) => setMilkDays(e.target.value)} inputMode="numeric" className={input} />
            </label>
            <label className="block text-sm text-gray-600">
              Absetzfrist Fleisch (Tage)
              <input value={meatDays} onChange={(e) => setMeatDays(e.target.value)} inputMode="numeric" className={input} />
            </label>
          </div>
          <label className="block text-sm text-gray-600">
            Behandelt durch
            <input value={administeredBy} onChange={(e) => setAdministeredBy(e.target.value)} className={input} />
          </label>
        </>
      )}
      <label className="block text-sm text-gray-600">
        {hasDiagnosis ? 'Bemerkung (optional)' : 'Bemerkung'}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={input} />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || animalIds.length === 0}
        className="w-full rounded-lg bg-brand-700 py-3 text-base font-semibold text-white disabled:opacity-50"
      >
        {saving ? 'Speichere…' : animalIds.length > 1 ? `Für ${animalIds.length} Tiere speichern` : 'Speichern'}
      </button>
    </div>
  )
}
