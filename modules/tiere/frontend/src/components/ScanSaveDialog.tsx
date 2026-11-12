import { useMemo, useState } from 'react'
import type { AnimalRef } from '@fmis/core/animals'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { fmtDate, todayIso } from '../lib/format'
import { majoritySpecies, planSave, type ScanResolved } from '../lib/groupScan'
import { constituteGroup, type HerdData } from '../lib/herds'
import type { HerdGroup } from '../types'
import Modal from './Modal'

const field = 'min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base'

/** Gescannte Gruppe speichern: als neue Gruppe anlegen oder eine bestehende ersetzen (genau diese Tiere,
 * alle anderen verlassen sie). Zeigt vorher, was sich ändert; ein Schritt, «Rückgängig» nimmt alles zurück. */
export default function ScanSaveDialog({
  data,
  resolved,
  source,
  defaultName,
  onSaved,
  onClose,
}: {
  data: HerdData
  resolved: ScanResolved
  /** z.B. «Gruppe vom Lesegerät (Weide Nord)» — für den Rückgängig-Text */
  source: string
  defaultName?: string
  onSaved: (group: HerdGroup) => void
  onClose: () => void
}) {
  const animals: AnimalRef[] = useMemo(() => resolved.matched.map((m) => m.animal), [resolved])
  const species = majoritySpecies(animals)
  const candidates = useMemo(() => data.groups.filter((g) => g.active && g.species === species).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de')), [data, species])
  const [mode, setMode] = useState<'new' | 'replace'>('new')
  const [name, setName] = useState(defaultName ?? '')
  const [milking, setMilking] = useState(false)
  const [targetId, setTargetId] = useState(candidates[0]?.id ?? '')
  const [date, setDate] = useState(todayIso())
  const [busy, setBusy] = useState(false)

  const target = candidates.find((g) => g.id === targetId) ?? null
  const plan = useMemo(() => planSave(data, mode === 'replace' ? target : null, animals, date, mode === 'replace'), [data, mode, target, animals, date])
  const nameClash = mode === 'new' && !!name.trim() && data.groups.some((g) => g.active && g.name.trim().toLowerCase() === name.trim().toLowerCase())
  const canSave = animals.length > 0 && !busy && (mode === 'new' ? !!name.trim() : !!target)

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      const group: HerdGroup =
        mode === 'replace' && target
          ? { ...target, active: true }
          : { id: crypto.randomUUID(), name: name.trim(), species, milking, active: true, sort_order: (data.groups.length + 1) * 10, notes: null, updated_at: '', deleted_at: null }
      // constituteGroup legt die Gruppe mit an bzw. aktiviert sie: alles ein Schritt
      const { added, left } = await undoAction(`${source} → «${group.name}»`, () => constituteGroup(data, { group, animals, date, replace: mode === 'replace' }))
      notifySuccess(`«${group.name}»: ${added} Tiere dazu${left ? `, ${left} jetzt ohne Gruppe` : ''}`)
      onSaved(group)
    } catch (e) {
      notifyError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Gruppe speichern" onClose={() => !busy && onClose()} onSubmit={() => void save()}>
      <div className="space-y-3 text-sm">
        <p className="rounded-lg bg-gray-50 p-2">
          <b>{animals.length}</b> {animals.length === 1 ? 'Tier' : 'Tiere'} erkannt
          {resolved.unknown.length > 0 && (
            <span className="text-amber-800">
              , <b>{resolved.unknown.length}</b> unbekannte Ohrmarke{resolved.unknown.length === 1 ? '' : 'n'} (werden übersprungen)
            </span>
          )}
          .
        </p>

        <div className="space-y-2">
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} className="mt-1 h-5 w-5" />
            <span className="flex-1">
              <b>Neue Gruppe anlegen</b>
              {mode === 'new' && (
                <span className="mt-1 block space-y-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name der Gruppe" aria-label="Name der neuen Gruppe" className={field} />
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={milking} onChange={(e) => setMilking(e.target.checked)} className="h-5 w-5" />
                    gemolkene Gruppe
                  </label>
                  {nameClash && <span className="block text-amber-800">Eine Gruppe mit diesem Namen gibt es schon — lieber «ersetzen» wählen.</span>}
                </span>
              )}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} disabled={candidates.length === 0} className="mt-1 h-5 w-5" />
            <span className="flex-1">
              <b>Bestehende Gruppe ersetzen</b>
              <span className="block text-gray-600">Genau diese Tiere stehen danach in der Gruppe, alle anderen verlassen sie.</span>
              {mode === 'replace' && (
                <select value={targetId} onChange={(e) => setTargetId(e.target.value)} aria-label="Zu ersetzende Gruppe" className={`${field} mt-1`}>
                  {candidates.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
              {candidates.length === 0 && <span className="block text-gray-500">Keine aktive Gruppe dieser Tierart.</span>}
            </span>
          </label>
        </div>

        <label className="flex items-center gap-2">
          <span className="font-medium text-gray-700">Gültig ab</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-2" />
        </label>

        <ul className="list-disc space-y-0.5 pl-5 text-gray-800">
          <li>{plan.add.length} kommen neu in die Gruppe</li>
          {plan.stay.length > 0 && <li>{plan.stay.length} {plan.stay.length === 1 ? 'steht' : 'stehen'} schon darin</li>}
          {plan.moving.length > 0 && (
            <li className="text-amber-800">
              {plan.moving.length} wechseln aus einer anderen Gruppe ({[...new Set(plan.moving.map((m) => m.from.name))].join(', ')})
            </li>
          )}
          {plan.leaving.length > 0 && <li className="text-amber-800">{plan.leaving.length} verlassen die Gruppe und stehen danach «ohne Gruppe»</li>}
        </ul>

        <div className="flex gap-2">
          <button type="button" disabled={!canSave} onClick={() => void save()} className="min-h-12 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-50">
            {busy ? 'speichert …' : `Ab ${fmtDate(date)} speichern`}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="min-h-12 rounded-lg border border-gray-300 px-4">
            Zurück
          </button>
        </div>
      </div>
    </Modal>
  )
}
