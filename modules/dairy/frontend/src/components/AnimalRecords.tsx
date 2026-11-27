// Teile der Tierseite (pages/AnimalDetail.tsx), je Zeile mit Stift (✎) korrigierbar: Trächtigkeitsbefunde,
// Gewichte und Absetzen, offene Pendenzen, Belegung (Datum und Vater). Bearbeiten und Löschen erst nach dem Stift.

import { useState, type ReactNode } from 'react'
import { animalKey } from '@fmis/core/earTag'
import { useDb } from '@fmis/core/DbContext'
import Modal from '@fmis/core/Modal'
import { errorText, notifyError } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { softDeleteRow, upsertRow } from '../db/write'
import { fmtDate, localTodayIso } from '../lib/format'
import { METHOD_LABEL, RESULT_LABEL } from '../lib/pregnancy'
import { durationText, parseKg, WEAN_REASON_LABEL, type CheckRecord, type WeaningRecord, type WeightRecord } from '../lib/animalRecords'
import { completeReminder, deleteReminder, dueText, updateReminder, type AnimalReminder } from '../lib/reminders'
import { NURSING_MAX_DAYS } from '../lib/lambs'
import type { SireOption } from '../lib/sires'
import SireSelect, { type SireValue } from './SireSelect'
import type { PregnancyResult } from '../types'

export function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32 rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">{title}</h2>
      {children}
    </section>
  )
}

/** Löschen mit Rückfrage. */
export function DeleteButton({ onConfirm, label = 'löschen' }: { onConfirm: () => Promise<void>; label?: string }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  return confirm ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        onConfirm()
          .then(() => setConfirm(false))
          .catch((e) => notifyError(`Nicht gelöscht: ${errorText(e)}`))
          .finally(() => setBusy(false))
      }}
      className="min-h-11 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50"
    >
      Wirklich löschen?
    </button>
  ) : (
    <button type="button" onClick={() => setConfirm(true)} className="grid h-11 w-11 place-items-center text-lg leading-none text-gray-600" aria-label={label}>
      ×
    </button>
  )
}

export function PenButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-expanded={open} onClick={onClick} className="grid h-11 w-11 shrink-0 place-items-center text-base leading-none text-gray-600" aria-label={label}>
      ✎
    </button>
  )
}

const input = 'min-h-11 w-full rounded-lg border border-gray-300 px-2 text-base'
const chip = (on: boolean) => `min-h-11 flex-1 rounded-lg border px-2 text-sm ${on ? 'border-brand-700 bg-brand-50 font-semibold text-brand-900' : 'border-gray-300 bg-white text-gray-800'}`

/** Bearbeiten-Kasten unter einer Zeile: Felder, dann Speichern · Löschen · Abbrechen. */
function EditBox({ children, onSave, onDelete, onCancel, error }: { children: ReactNode; onSave: () => Promise<void>; onDelete: () => Promise<void>; onCancel: () => void; error?: string | null }) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const run = (fn: () => Promise<void>) => {
    setBusy(true)
    fn()
      .catch((e) => notifyError(errorText(e)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="mt-1 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
      {children}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => run(onSave)} className="min-h-11 flex-1 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white disabled:opacity-50">
          Speichern
        </button>
        {confirm ? (
          <button type="button" disabled={busy} onClick={() => run(onDelete)} className="min-h-11 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white disabled:opacity-50">
            Wirklich löschen?
          </button>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="min-h-11 rounded-lg border border-red-300 bg-white px-3 text-sm text-red-800">
            Löschen
          </button>
        )}
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700">
          Abbrechen
        </button>
      </div>
    </div>
  )
}

/** Datum prüfen: gesetzt und nicht in der Zukunft. */
const dateError = (d: string) => (!d ? 'Datum fehlt.' : d > localTodayIso() ? 'Das Datum liegt in der Zukunft.' : null)

// ---------- Trächtigkeit ----------

export function PregnancyList({ checks }: { checks: CheckRecord[] }) {
  const [edit, setEdit] = useState<string | null>(null)
  return (
    <ul className="divide-y text-sm">
      {checks.map((c) => (
        <li key={c.id} className="py-1">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 tabular-nums text-gray-500">{fmtDate(c.check_date)}</span>
            <span className="min-w-0 flex-1">
              <span className={`font-medium ${c.result === 'ja' ? 'text-green-800' : c.result === 'nein' ? 'text-red-700' : 'text-gray-800'}`}>{RESULT_LABEL[c.result]}</span>
              <span className="text-gray-600">
                {[c.result === 'ja' && durationText(c.weeks, c.duration_unit), c.method && METHOD_LABEL[c.method], c.examiner].filter(Boolean).map((t) => ` · ${t}`)}
              </span>
              {c.notes && <span className="block text-xs text-gray-600">{c.notes}</span>}
            </span>
            <PenButton open={edit === c.id} onClick={() => setEdit(edit === c.id ? null : c.id)} label={`Befund vom ${fmtDate(c.check_date)} bearbeiten`} />
          </div>
          {edit === c.id && <PregnancyEdit check={c} onDone={() => setEdit(null)} />}
        </li>
      ))}
    </ul>
  )
}

function PregnancyEdit({ check, onDone }: { check: CheckRecord; onDone: () => void }) {
  const db = useDb()
  const [result, setResult] = useState<PregnancyResult>(check.result)
  const [date, setDate] = useState(check.check_date)
  const [notes, setNotes] = useState(check.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  return (
    <EditBox
      error={error}
      onCancel={onDone}
      onSave={async () => {
        const e = dateError(date)
        if (e) return setError(e)
        await undoAction(`Trächtigkeitsbefund vom ${fmtDate(date)} geändert`, () => upsertRow(db, 'pregnancy_checks', { id: check.id, result, check_date: date, notes: notes.trim() || null }))
        onDone()
      }}
      onDelete={async () => {
        await undoAction(`Trächtigkeitsbefund vom ${fmtDate(check.check_date)} gelöscht`, () => softDeleteRow(db, 'pregnancy_checks', check.id))
        onDone()
      }}
    >
      <div className="flex gap-2" role="radiogroup" aria-label="Ergebnis">
        {(['ja', 'nein', 'unsicher'] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={result === r} onClick={() => setResult(r)} className={chip(result === r)}>
            {RESULT_LABEL[r]}
          </button>
        ))}
      </div>
      <label className="block text-xs text-gray-600">
        Datum
        <input type="date" value={date} max={localTodayIso()} onChange={(e) => setDate(e.target.value)} className={input} />
      </label>
      <label className="block text-xs text-gray-600">
        Notiz
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
      </label>
    </EditBox>
  )
}

// ---------- Gewichte / Absetzen ----------

export function WeightsList({ weights, weanings }: { weights: WeightRecord[]; weanings: WeaningRecord[] }) {
  const [edit, setEdit] = useState<string | null>(null)
  const toggle = (k: string) => setEdit(edit === k ? null : k)
  return (
    <ul className="divide-y text-sm">
      {weanings.map((w) => (
        <li key={`a:${w.id}`} className="py-1">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 tabular-nums text-gray-500">{fmtDate(w.wean_date)}</span>
            <span className="min-w-0 flex-1 text-gray-800">
              ✂️ {w.reason ? (WEAN_REASON_LABEL[w.reason] ?? w.reason) : 'abgesetzt'}
              {w.herd_group && <span className="text-gray-600"> · in {w.herd_group}</span>}
              {w.notes && <span className="block text-xs text-gray-600">{w.notes}</span>}
            </span>
            <PenButton open={edit === `a:${w.id}`} onClick={() => toggle(`a:${w.id}`)} label={`Absetzen vom ${fmtDate(w.wean_date)} bearbeiten`} />
          </div>
          {edit === `a:${w.id}` && <WeaningEdit weaning={w} onDone={() => setEdit(null)} />}
        </li>
      ))}
      {weights.map((w) => (
        <li key={`g:${w.id}`} className="py-1">
          <div className="flex items-center gap-2">
            <span className="w-20 shrink-0 tabular-nums text-gray-500">{fmtDate(w.weigh_date)}</span>
            <span className="min-w-0 flex-1 text-gray-800">
              <span className="font-medium tabular-nums">{w.weight_kg.toLocaleString('de-CH')} kg</span>
              {w.notes && <span className="text-gray-600"> · {w.notes}</span>}
            </span>
            <PenButton open={edit === `g:${w.id}`} onClick={() => toggle(`g:${w.id}`)} label={`Gewicht vom ${fmtDate(w.weigh_date)} bearbeiten`} />
          </div>
          {edit === `g:${w.id}` && <WeightEdit weight={w} onDone={() => setEdit(null)} />}
        </li>
      ))}
    </ul>
  )
}

function WeightEdit({ weight, onDone }: { weight: WeightRecord; onDone: () => void }) {
  const db = useDb()
  const [date, setDate] = useState(weight.weigh_date)
  const [kg, setKg] = useState(String(weight.weight_kg))
  const [notes, setNotes] = useState(weight.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  return (
    <EditBox
      error={error}
      onCancel={onDone}
      onSave={async () => {
        const e = dateError(date)
        if (e) return setError(e)
        const n = parseKg(kg)
        if (n == null) return setError('Gewicht in kg eingeben.')
        await undoAction(`Gewicht vom ${fmtDate(date)} geändert`, () => upsertRow(db, 'animal_weights', { id: weight.id, weigh_date: date, weight_kg: n, notes: notes.trim() || null }))
        onDone()
      }}
      onDelete={async () => {
        await undoAction(`Gewicht vom ${fmtDate(weight.weigh_date)} gelöscht`, () => softDeleteRow(db, 'animal_weights', weight.id))
        onDone()
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-gray-600">
          Datum
          <input type="date" value={date} max={localTodayIso()} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
        <label className="block text-xs text-gray-600">
          kg
          <input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={input} />
        </label>
      </div>
      <label className="block text-xs text-gray-600">
        Notiz
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} />
      </label>
    </EditBox>
  )
}

function WeaningEdit({ weaning, onDone }: { weaning: WeaningRecord; onDone: () => void }) {
  const db = useDb()
  const [date, setDate] = useState(weaning.wean_date)
  const [reason, setReason] = useState(weaning.reason ?? 'abgesetzt')
  const [error, setError] = useState<string | null>(null)
  return (
    <EditBox
      error={error}
      onCancel={onDone}
      onSave={async () => {
        const e = dateError(date)
        if (e) return setError(e)
        await undoAction(`Absetzen vom ${fmtDate(date)} geändert`, () => upsertRow(db, 'weanings', { id: weaning.id, wean_date: date, reason }))
        onDone()
      }}
      onDelete={async () => {
        await undoAction(`Absetzen vom ${fmtDate(weaning.wean_date)} gelöscht`, () => softDeleteRow(db, 'weanings', weaning.id))
        onDone()
      }}
    >
      <div className="flex gap-2" role="radiogroup" aria-label="Grund">
        {(['abgesetzt', 'weggenommen'] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className={chip(reason === r)}>
            {r === 'abgesetzt' ? 'Abgesetzt' : 'Von der Mutter weggenommen'}
          </button>
        ))}
      </div>
      <label className="block text-xs text-gray-600">
        Datum
        <input type="date" value={date} max={localTodayIso()} onChange={(e) => setDate(e.target.value)} className={input} />
      </label>
      <p className="text-xs text-gray-600">Löschen: das Tier gilt wieder als saugend (bis {NURSING_MAX_DAYS} Tage alt).</p>
    </EditBox>
  )
}

// ---------- Pendenzen ----------

export function ReminderList({ reminders }: { reminders: AnimalReminder[] }) {
  const db = useDb()
  const [edit, setEdit] = useState<string | null>(null)
  const today = localTodayIso()
  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">Offene Pendenzen</div>
      <ul className="divide-y divide-amber-200 text-sm">
        {reminders.map((r) => (
          <li key={r.id} className="py-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="text-gray-900">⏰ {r.title}</span>
                <span className={`block text-xs ${r.due_date < today ? 'font-semibold text-red-700' : 'text-gray-600'}`}>
                  {fmtDate(r.due_date)} · {dueText(r.due_date, today)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void undoAction(`Pendenz erledigt: ${r.title}`, () => completeReminder(db, r.id)).catch((e) => notifyError(errorText(e)))}
                className="min-h-11 shrink-0 rounded-lg border border-green-300 bg-white px-3 text-sm font-medium text-green-900"
              >
                ✓ Erledigt
              </button>
              <PenButton open={edit === r.id} onClick={() => setEdit(edit === r.id ? null : r.id)} label={`Pendenz «${r.title}» bearbeiten`} />
            </div>
            {edit === r.id && <ReminderEdit reminder={r} onDone={() => setEdit(null)} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ReminderEdit({ reminder, onDone }: { reminder: AnimalReminder; onDone: () => void }) {
  const db = useDb()
  const [title, setTitle] = useState(reminder.title)
  const [date, setDate] = useState(reminder.due_date)
  const [error, setError] = useState<string | null>(null)
  return (
    <EditBox
      error={error}
      onCancel={onDone}
      onSave={async () => {
        if (!title.trim()) return setError('Text fehlt.')
        if (!date) return setError('Datum fehlt.')
        await undoAction(`Pendenz geändert: ${title.trim()}`, () => updateReminder(db, reminder.id, { title: title.trim(), due_date: date }))
        onDone()
      }}
      onDelete={async () => {
        await undoAction(`Pendenz gelöscht: ${reminder.title}`, () => deleteReminder(db, reminder.id))
        onDone()
      }}
    >
      <label className="block text-xs text-gray-600">
        Text
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
      </label>
      <label className="block text-xs text-gray-600">
        Fällig am
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
      </label>
    </EditBox>
  )
}

// ---------- Belegung korrigieren ----------

export interface EditableMating {
  id: string
  service_date: string
  service_to: string | null
  seq: number | null
  sire_key: string | null
  sire_ear_tag: string | null
  sire_name: string | null
}

/** Datum und Vater einer in FMIS erfassten Belegung korrigieren (Löschen bleibt in der Liste). */
export function MatingEditDialog({ mating, damEarTag, sires, sireLabel, onClose }: { mating: EditableMating; damEarTag: string; sires: SireOption[]; sireLabel: string; onClose: () => void }) {
  const db = useDb()
  const [sire, setSire] = useState<SireValue>({ key: mating.sire_key, ear_tag: mating.sire_ear_tag ?? '', name: mating.sire_name ?? '' })
  const [from, setFrom] = useState(mating.service_date)
  const [to, setTo] = useState(mating.service_to ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function save() {
    const sireKey = sire.key ?? animalKey(sire.ear_tag)
    const e = dateError(from)
    if (e) return setError(e)
    if (to && to < from) return setError('«bis» liegt vor «von».')
    if (!sireKey && !sire.name.trim()) return setError('Vatertier angeben.')
    setBusy(true)
    try {
      const damKey = animalKey(damEarTag) ?? damEarTag
      await undoAction(`Belegung vom ${fmtDate(from)} geändert`, () =>
        upsertRow(db, 'matings', {
          id: mating.id,
          service_date: from,
          service_to: to || null,
          sire_key: sireKey,
          sire_ear_tag: sire.ear_tag.trim() || null,
          sire_name: sire.name.trim() || null,
          // Schlüssel wie beim Erfassen (pages/MatingEntry.tsx), damit ein späterer Import dieselbe Belegung erkennt
          import_key: `${damKey}|${from}|${mating.seq ?? 1}|${sireKey ?? ''}`,
        }),
      )
      onClose()
    } catch (err) {
      setError(errorText(err, 'Speichern fehlgeschlagen'))
      setBusy(false)
    }
  }
  return (
    <Modal title="Belegung korrigieren" onClose={onClose} onSubmit={() => void save()}>
      <div className="space-y-3 text-sm">
        <SireSelect label={sireLabel} options={sires} value={sire} onChange={setSire} />
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-gray-600">
            {to ? 'von' : 'Datum'}
            <input type="date" value={from} max={localTodayIso()} onChange={(e) => setFrom(e.target.value)} className={input} />
          </label>
          <label className="block text-gray-600">
            bis (optional)
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </label>
        </div>
        {error && <p className="text-red-700">{error}</p>}
        <button type="button" disabled={busy} onClick={() => void save()} className="min-h-12 w-full rounded-lg bg-brand-700 font-semibold text-white disabled:opacity-40">
          Speichern
        </button>
      </div>
    </Modal>
  )
}
