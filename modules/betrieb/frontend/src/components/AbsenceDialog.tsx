import { useState } from 'react'
import { undoAction } from '@fmis/core/undo'
import { errorText } from '@fmis/core/toast'
import { deleteAbsence, saveAbsence } from '../lib/dutyData'
import type { DutyAbsence, DutyAbsenceKind } from '../types'
import Modal from './Modal'

export const ABSENCE_KIND: Record<DutyAbsenceKind, string> = { ferien: 'Ferien', frei: 'frei', krank: 'krank', kurs: 'Kurs', schule: 'Schule', andere: 'abwesend' }
const field = 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-base'

/** Darf diese Person die Abwesenheit ändern oder löschen? Das Büro alles; Mitarbeitende nur die eigene
 * Krankmeldung (wie der Server, modules/betrieb/backend/app/duty_requests.py). */
export function mayEditAbsence(a: Pick<DutyAbsence, 'person_id' | 'kind'>, canWrite: boolean, selfId: string | null | undefined): boolean {
  return canWrite || (!!selfId && a.person_id === selfId && a.kind === 'krank')
}

/** Abwesenheit ändern (von, bis, Art, Notiz) oder löschen (weich, mit Rückgängig). */
export default function AbsenceDialog({ absence, who, canWrite, onClose }: { absence: DutyAbsence; who: string; canWrite: boolean; onClose: () => void }) {
  const [f, setF] = useState({ from_date: absence.from_date, to_date: absence.to_date, kind: absence.kind, notes: absence.notes ?? '' })
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Schultage aus dem Stundenplan: Datum und Art führt der Abgleich (sonst trägt er sie neu ein)
  const fromTimetable = absence.source === 'webuntis'
  const range = (a: string, b: string) => (a === b ? a.split('-').reverse().join('.') : `${a.split('-').reverse().join('.')}–${b.split('-').reverse().join('.')}`)
  async function run(label: string, job: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await undoAction(label, job)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    if (!f.from_date || !f.to_date) return setError('Von und bis angeben.')
    if (f.to_date < f.from_date) return setError('«bis» liegt vor «von».')
    void run(`Abwesenheit ${who} geändert`, () =>
      saveAbsence({ ...absence, from_date: f.from_date, to_date: f.to_date, kind: f.kind, notes: f.notes.trim() || null }),
    )
  }
  return (
    <Modal title={`Abwesenheit ${who}`} onClose={onClose}>
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            von
            <input type="date" className={field} value={f.from_date} disabled={fromTimetable} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: e.target.value > f.to_date ? e.target.value : f.to_date })} />
          </label>
          <label className="flex items-center gap-1">
            bis
            <input type="date" className={field} value={f.to_date} min={f.from_date} disabled={fromTimetable} onChange={(e) => setF({ ...f, to_date: e.target.value })} />
          </label>
        </div>
        <label className="flex items-center gap-2">
          Art
          <select className={field} value={f.kind} disabled={!canWrite || fromTimetable} onChange={(e) => setF({ ...f, kind: e.target.value as DutyAbsenceKind })}>
            {(Object.keys(ABSENCE_KIND) as DutyAbsenceKind[]).map((k) => (
              <option key={k} value={k}>
                {ABSENCE_KIND[k]}
              </option>
            ))}
          </select>
        </label>
        {!canWrite && <p className="text-xs text-gray-500">Die Art ändert das Büro; du kannst deine Krankmeldung verschieben oder löschen.</p>}
        {fromTimetable && <p className="text-xs text-gray-500">Aus dem Stundenplan: Datum und Art führt der nächtliche Abgleich.</p>}
        <textarea className={`${field} w-full`} rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Notiz (freiwillig)" aria-label="Notiz" />
        {error && <p className="text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={save} className="min-h-11 flex-1 rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-50">
            Speichern
          </button>
          {confirm ? (
            <button type="button" disabled={busy} onClick={() => void run(`Abwesenheit ${who} ${range(absence.from_date, absence.to_date)} gelöscht`, () => deleteAbsence(absence.id))} className="min-h-11 rounded-lg bg-red-600 px-3 font-semibold text-white">
              Wirklich löschen?
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirm(true)} className="min-h-11 rounded-lg border border-red-300 px-3 text-red-700">
              Löschen
            </button>
          )}
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg border border-gray-300 px-3">
            Abbrechen
          </button>
        </div>
      </div>
    </Modal>
  )
}
