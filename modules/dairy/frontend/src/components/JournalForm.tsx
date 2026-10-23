import { useState } from 'react'
import { useDb } from '@fmis/core/DbContext'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import { JOURNAL_CATEGORIES, journalSummary } from '../lib/journal'
import { localTodayIso } from '../lib/format'
import TreatmentForm from './TreatmentForm'
import type { AnimalJournalEntry, JournalCategory } from '../types'

/** Journaleintrag für ein oder mehrere Tiere — Beobachtung, Krankheit,
 * Brunst, Klauen, Notiz; Behandlung im Behandlungsjournal-Formular
 * (TreatmentForm). Mehrere Tiere ergeben je einen Eintrag, z.B.
 * Klauenpflege der ganzen Gruppe.
 *
 * Das Journal wird nur ergänzt: `caseId` hängt den neuen Eintrag an einen
 * bestehenden Fall (Verlaufsbeobachtung, Folgebehandlung), `corrects` erfasst
 * eine Korrektur als NEUEN Eintrag — der alte bleibt unverändert stehen. */
export default function JournalForm({
  animalIds,
  onSaved,
  caseId,
  corrects,
  defaultCategory = 'beobachtung',
}: {
  animalIds: string[]
  onSaved: () => void
  caseId?: string
  corrects?: AnimalJournalEntry
  defaultCategory?: JournalCategory
}) {
  const db = useDb()
  const [date, setDate] = useState(corrects?.entry_date ?? localTodayIso())
  const [category, setCategory] = useState<JournalCategory>(corrects?.category ?? defaultCategory)
  const [text, setText] = useState(corrects && corrects.text !== journalSummary(corrects) ? corrects.text : '')
  const [diagnosis, setDiagnosis] = useState(corrects?.diagnosis ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isTreatment = category === 'behandlung'
  const hasDiagnosis = category === 'krankheit'

  async function save() {
    if (animalIds.length === 0) return setError('Zuerst ein Tier wählen.')
    if (!hasDiagnosis && !text.trim()) return setError('Bitte eine Bemerkung erfassen.')
    setSaving(true)
    setError(null)
    try {
      const fields = {
        category,
        diagnosis: hasDiagnosis ? diagnosis.trim() || null : null,
        medication: null,
        dose: null,
        withdrawal_milk_days: null,
        withdrawal_meat_days: null,
        administered_by: null,
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
            // Krankheit eröffnet einen Fall, an den sich Verlauf und Folgebehandlungen hängen lassen
            case_id: corrects?.case_id ?? caseId ?? (category === 'krankheit' ? crypto.randomUUID() : null),
            corrects_id: corrects?.id ?? null,
          })
        }
      })
      setText('')
      setDiagnosis('')
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
      {corrects && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
          Korrektur zum Eintrag vom {corrects.entry_date}: Der ursprüngliche Eintrag bleibt unverändert stehen und wird als korrigiert markiert.
        </p>
      )}
      <div className={`flex flex-wrap gap-1.5 ${corrects ? 'hidden' : ''}`}>
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
      {isTreatment ? (
        <TreatmentForm animalIds={animalIds} onSaved={onSaved} caseId={caseId} corrects={corrects} />
      ) : (
        <>
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
            {saving ? 'Speichere…' : corrects ? 'Korrektur speichern' : animalIds.length > 1 ? `Für ${animalIds.length} Tiere speichern` : 'Speichern'}
          </button>
        </>
      )}
    </div>
  )
}
