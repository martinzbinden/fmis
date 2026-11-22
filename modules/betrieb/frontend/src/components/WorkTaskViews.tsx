import { useState } from 'react'
import AppIcon from '@fmis/core/AppIcon'
import { getCurrentUserEmail } from '@fmis/core/auth'
import Modal from './Modal'
import { fmtDate, todayIso } from '../lib/format'
import { activityByTitle, AREA_ICON, AREA_LABEL, cancelWorkTask, completeWorkTask, STABLE_CATEGORIES, targetIcon, type FarmJournalEntry, type WorkTask } from '../lib/workTasks'

const field = 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-base'

/** Karte einer Arbeit (Tiere, Gebäude, Maschinen, Brennholz, frei) im Arbeitsplan. */
export function WorkTaskCard({ task, personName, canWrite, onComplete, onChanged }: { task: WorkTask; personName: string | null; canWrite: boolean; onComplete: () => void; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const overdue = task.due_date && task.due_date < todayIso()
  return (
    <div className="space-y-2 rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <AppIcon icon={AREA_ICON[task.area]} size={36} />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-gray-800">{task.title}</div>
          <div className="text-sm text-gray-600">
            {AREA_LABEL[task.area]}
            {personName ? ` · ${personName}` : ''}
            {task.quantity != null ? ` · ${task.quantity.toLocaleString('de-CH')} ${task.unit ?? ''}` : ''}
            {task.due_date ? <span className={overdue ? 'font-semibold text-red-700' : ''}> · bis {fmtDate(task.due_date)}</span> : null}
            {task.source === 'shop' ? ' · aus dem Shop' : ''}
          </div>
          {task.customer && <div className="text-sm text-gray-700">für {task.customer}</div>}
          {task.notes && <div className="text-sm text-gray-600">{task.notes}</div>}
        </div>
      </div>
      {task.targets.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-sm">
          {task.targets.map((t) => (
            <li key={`${t.kind}${'id' in t ? t.id : t.label}`} className="flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-0.5 pr-2">
              <AppIcon icon={targetIcon[t.kind]} size={20} />
              {t.label}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <button type="button" onClick={onComplete} className="min-h-11 flex-1 rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700">
            ✓ Erledigt erfassen
          </button>
          {confirm ? (
            <button type="button" onClick={() => void cancelWorkTask(task).then(onChanged)} className="min-h-11 rounded-lg bg-red-600 px-3 py-2 text-sm text-white">
              Wirklich absagen?
            </button>
          ) : (
            <button type="button" onClick={() => setConfirm(true)} className="min-h-11 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">
              Absagen
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Arbeit abschliessen: Datum, was gemacht wurde; bei Tieren Kategorie im Stalljournal und allenfalls Medikament. */
export function CompleteTaskDialog({ task, onClose, onDone }: { task: WorkTask; onClose: () => void; onDone: (refs: string[]) => void }) {
  const animals = task.targets.some((t) => t.kind === 'tier' || t.kind === 'gruppe')
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState(activityByTitle(task.title, 'tiere')?.category ?? 'notiz')
  const [medication, setMedication] = useState('')
  const [dose, setDose] = useState('')
  const [quantity, setQuantity] = useState(task.quantity != null ? String(task.quantity) : '')
  const [doneBy, setDoneBy] = useState(getCurrentUserEmail() ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const q = quantity.trim() ? Number(quantity.replace(',', '.')) : null
      const refs = await completeWorkTask(task, { date, notes, category, medication, dose, doneBy, quantity: q != null && Number.isFinite(q) ? q : null })
      onDone(refs)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <Modal title={`Erledigt: ${task.title}`} onClose={onClose} onSubmit={() => void save()}>
      <div className="space-y-2 text-sm">
        <label className="block">
          <span className="text-gray-600">Datum</span>
          <input type="date" className={`${field} w-full`} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
        {animals && (
          <>
            <label className="block">
              <span className="text-gray-600">Stalljournal als</span>
              <select className={`${field} w-full`} value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(STABLE_CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {category === 'behandlung' && (
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="text-gray-600">Medikament</span>
                  <input className={`${field} w-full`} value={medication} onChange={(e) => setMedication(e.target.value)} />
                </label>
                <label>
                  <span className="text-gray-600">Dosis</span>
                  <input className={`${field} w-full`} value={dose} onChange={(e) => setDose(e.target.value)} />
                </label>
                <p className="col-span-2 text-xs text-gray-600">Für das Behandlungsjournal mit Absetzfristen besser «Beobachtung / Behandlung» im Tiermodul verwenden; hier ohne Absetzfrist.</p>
              </div>
            )}
          </>
        )}
        {(task.quantity != null || task.area === 'brennholz') && (
          <label className="block">
            <span className="text-gray-600">Menge {task.unit ? `(${task.unit})` : ''}</span>
            <input inputMode="decimal" className={`${field} w-full`} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="text-gray-600">Was gemacht, Befund</span>
          <textarea className={`${field} w-full`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-gray-600">Ausgeführt von</span>
          <input className={`${field} w-full`} value={doneBy} onChange={(e) => setDoneBy(e.target.value)} />
        </label>
        <p className="text-xs text-gray-600">Kommt ins {animals ? 'Stalljournal der Tiere (Gruppen: alle Tiere am Datum)' : 'Betriebsjournal'}{task.targets.some((t) => t.kind === 'maschine') ? ' und ins Maschinenjournal' : ''}.</p>
        {err && <p className="text-red-700">{err}</p>}
        <button type="button" disabled={busy} onClick={() => void save()} className="min-h-12 w-full rounded-lg bg-green-700 font-semibold text-white disabled:opacity-40">
          Eintragen
        </button>
      </div>
    </Modal>
  )
}

/** Betriebsjournal: erledigte Arbeiten an Gebäuden, Maschinen, Brennholz und weitere. */
export function FarmJournalList({ entries }: { entries: FarmJournalEntry[] }) {
  if (entries.length === 0) return <p className="rounded-lg bg-white p-4 text-sm text-gray-600 shadow-sm">Noch keine Einträge. Erledigte Arbeiten (ausser Parzellen und Tiere mit Stalljournal) erscheinen hier.</p>
  return (
    <ul className="divide-y rounded-lg bg-white text-sm shadow-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3 px-3 py-2">
          <AppIcon icon={AREA_ICON[e.area as keyof typeof AREA_ICON] ?? 'erfassen'} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="font-semibold text-gray-900">{e.title}</span>
              <span className="text-xs tabular-nums text-gray-600">{fmtDate(e.entry_date)}</span>
            </div>
            <div className="text-gray-700">
              {e.targets.map((t) => t.label).join(', ')}
              {e.quantity != null ? `${e.targets.length ? ' · ' : ''}${e.quantity.toLocaleString('de-CH')} ${e.unit ?? ''}` : ''}
              {e.customer ? ` · für ${e.customer}` : ''}
            </div>
            {e.notes && <div className="text-gray-600">{e.notes}</div>}
            {e.done_by && <div className="text-xs text-gray-500">{e.done_by}</div>}
          </div>
        </li>
      ))}
    </ul>
  )
}
