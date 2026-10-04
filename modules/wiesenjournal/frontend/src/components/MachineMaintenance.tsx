import { useState } from 'react'
import Modal from './Modal'
import { fmtDate, todayIso } from '../lib/format'
import {
  counterUnit,
  hasCounter,
  intervalText,
  latestCounter,
  parseTaskIds,
  STATE_ORDER,
  taskStatus,
  TEMPLATES,
  type DueState,
  type TaskStatus,
  type TrackSpan,
} from '../lib/maintenance'
import { applyTemplate, deleteEntry, deleteTask, saveEntry, saveTask } from '../lib/maintenanceData'
import type { Machine, MaintenanceEntryType, MaintenanceLog, MaintenanceTask, MaintenanceTaskType } from '../types'

export const STATE_STYLE: Record<DueState, string> = {
  faellig: 'bg-red-100 text-red-800',
  bald: 'bg-amber-100 text-amber-900',
  offen: 'bg-sky-100 text-sky-800',
  ok: 'bg-emerald-50 text-emerald-800',
}
export const STATE_LABEL: Record<DueState, string> = { faellig: 'fällig', bald: 'bald', offen: 'noch nie erfasst', ok: 'ok' }

const ENTRY_LABEL: Record<MaintenanceEntryType, string> = {
  wartung: 'Wartung',
  reparatur: 'Reparatur',
  kontrolle: 'Kontrolle',
  zaehlerstand: 'Zählerstand',
}
const TYPE_LABEL: Record<MaintenanceTaskType, string> = {
  oel: 'Öl',
  filter: 'Filter',
  schmieren: 'Schmieren',
  kontrolle: 'Kontrolle',
  verschleiss: 'Verschleiss',
  service: 'Service',
  andere: 'andere',
}

const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
const btn = 'rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 active:bg-gray-50'
const n = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.').replace(/['’\s]/g, '')))
const fmtNum = (v: number) => v.toLocaleString('de-CH', { maximumFractionDigits: 1 })
const chf = (v: number) => `CHF ${v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** "fällig in 12 Tagen · in 50 h" bzw. "seit 3 Tagen überfällig" */
function dueText(s: TaskStatus, unit: 'h' | 'km'): string {
  if (s.state === 'offen') return 'Ersten Eintrag erfassen, dann wird gerechnet'
  const parts: string[] = []
  if (s.daysLeft != null) parts.push(s.daysLeft < 0 ? `${-s.daysLeft} Tage überfällig` : s.daysLeft === 0 ? 'heute' : `in ${s.daysLeft} Tagen (${fmtDate(s.dueDate)})`)
  if (s.countLeft != null) parts.push(s.countLeft <= 0 ? `${fmtNum(-s.countLeft)} ${unit} drüber` : `in ${fmtNum(s.countLeft)} ${unit}`)
  return parts.join(' · ') || '–'
}

/** Eintrag erfassen/bearbeiten: Wartung (hakt Aufgaben ab), Reparatur,
 * Kontrolle oder nur Zählerstand. */
function EntryDialog({
  machine,
  tasks,
  entry,
  preselect,
  type: initialType,
  title: initialTitle,
  onClose,
}: {
  machine: Machine
  tasks: MaintenanceTask[]
  entry: MaintenanceLog | null
  preselect?: string[]
  type?: MaintenanceEntryType
  title?: string
  onClose: (changed: boolean) => void
}) {
  const unit = counterUnit(machine)
  const [f, setF] = useState({
    done_date: entry?.done_date ?? todayIso(),
    entry_type: entry?.entry_type ?? initialType ?? ('wartung' as MaintenanceEntryType),
    title: entry?.title ?? initialTitle ?? '',
    counter: entry?.counter == null ? '' : String(entry.counter),
    cost: entry?.cost_chf == null ? '' : String(entry.cost_chf),
    material: entry?.material ?? '',
    done_by: entry?.done_by ?? '',
    notes: entry?.notes ?? '',
  })
  const [selected, setSelected] = useState<Set<string>>(new Set(entry ? parseTaskIds(entry.task_ids) : (preselect ?? [])))
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }))
  const counterOnly = f.entry_type === 'zaehlerstand'
  const valid = counterOnly ? n(f.counter) != null : selected.size > 0 || f.title.trim() !== ''

  async function save() {
    setBusy(true)
    try {
      await saveEntry({
        id: entry?.id ?? crypto.randomUUID(),
        machine_id: machine.id,
        done_date: f.done_date,
        entry_type: f.entry_type,
        title: f.title.trim() || null,
        task_ids: counterOnly || selected.size === 0 ? null : JSON.stringify([...selected]),
        counter: n(f.counter),
        cost_chf: counterOnly ? null : n(f.cost),
        material: counterOnly ? null : f.material.trim() || null,
        done_by: f.done_by.trim() || null,
        notes: f.notes.trim() || null,
        updated_at: '',
        deleted_at: null,
      })
      onClose(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`${entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag'} — ${machine.name}`} onClose={() => !busy && onClose(false)}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(ENTRY_LABEL) as MaintenanceEntryType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ entry_type: t })}
              className={`rounded-lg px-2.5 py-1 text-xs ${f.entry_type === t ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
            >
              {ENTRY_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Datum</span>
            <input type="date" className={field} value={f.done_date} onChange={(e) => set({ done_date: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">{unit === 'km' ? 'km-Stand' : hasCounter(machine) ? 'Stundenzähler (h)' : 'Stunden (optional)'}</span>
            <input className={field} inputMode="decimal" value={f.counter} onChange={(e) => set({ counter: e.target.value })} />
          </label>
        </div>
        {!counterOnly && (
          <>
            {tasks.length > 0 && (
              <div>
                <span className="mb-1 block font-medium text-gray-700">Erledigt aus dem Wartungsplan</span>
                <div className="max-h-48 space-y-0.5 overflow-y-auto rounded border border-gray-200 p-1.5">
                  {tasks.map((t) => (
                    <label key={t.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selected.has(t.id)}
                        onChange={(e) => {
                          const next = new Set(selected)
                          if (e.target.checked) next.add(t.id)
                          else next.delete(t.id)
                          setSelected(next)
                        }}
                      />
                      <span>{t.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">{f.entry_type === 'reparatur' ? 'Was wurde repariert?' : 'Beschreibung (optional)'}</span>
              <input className={field} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={f.entry_type === 'reparatur' ? 'z.B. Hydraulikschlauch Hubwerk ersetzt' : ''} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block font-medium text-gray-700">Kosten CHF</span>
                <input className={field} inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-gray-700">Erledigt von</span>
                <input className={field} value={f.done_by} onChange={(e) => set({ done_by: e.target.value })} placeholder="selbst, Werkstatt …" />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">Material / Ersatzteile</span>
              <input className={field} value={f.material} onChange={(e) => set({ material: e.target.value })} placeholder="z.B. 12 l 15W-40, Filter RE504836" />
            </label>
          </>
        )}
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Notiz</span>
          <input className={field} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <div className="flex gap-2">
          {entry && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm('Eintrag löschen?')) void deleteEntry(entry.id).then(() => onClose(true))
              }}
              className="rounded-lg border border-red-200 px-3 py-2 text-red-700"
            >
              Löschen
            </button>
          )}
          <button type="button" disabled={busy || !valid} onClick={() => void save()} className="flex-1 rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50">
            Speichern
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Wartungsplan-Aufgabe anlegen/bearbeiten. */
function TaskDialog({ machine, task, count, onClose }: { machine: Machine; task: MaintenanceTask | null; count: number; onClose: (changed: boolean) => void }) {
  const unit = counterUnit(machine)
  const [f, setF] = useState({
    title: task?.title ?? '',
    task_type: task?.task_type ?? ('kontrolle' as MaintenanceTaskType),
    interval_count: task?.interval_count == null ? '' : String(task.interval_count),
    interval_months: task?.interval_months == null ? '' : String(task.interval_months),
    notes: task?.notes ?? '',
    active: task?.active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }))

  async function save() {
    setBusy(true)
    try {
      await saveTask({
        id: task?.id ?? crypto.randomUUID(),
        machine_id: machine.id,
        title: f.title.trim(),
        task_type: f.task_type,
        interval_count: n(f.interval_count),
        interval_months: n(f.interval_months),
        notes: f.notes.trim() || null,
        active: f.active,
        sort_order: task?.sort_order ?? (count + 1) * 10,
        template_key: task?.template_key ?? null,
        updated_at: '',
        deleted_at: null,
      })
      onClose(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={task ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} onClose={() => !busy && onClose(false)}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Aufgabe</span>
          <input className={field} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="z.B. Motoröl und Ölfilter wechseln" />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Art</span>
          <select className={field} value={f.task_type} onChange={(e) => set({ task_type: e.target.value as MaintenanceTaskType })}>
            {(Object.keys(TYPE_LABEL) as MaintenanceTaskType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">alle … {unit === 'km' ? 'km' : 'Stunden'}</span>
            <input className={field} inputMode="decimal" value={f.interval_count} onChange={(e) => set({ interval_count: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">oder alle … Monate</span>
            <input className={field} inputMode="numeric" value={f.interval_months} onChange={(e) => set({ interval_months: e.target.value.replace(/\D/g, '') })} />
          </label>
        </div>
        <p className="text-xs text-gray-500">
          Fällig ist, was zuerst eintritt.{' '}
          {unit === 'h' && !hasCounter(machine) ? 'Stunden zählen aus den GPS-Fahrten mit diesem Gerät.' : ''}
        </p>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Hinweis</span>
          <input className={field} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="z.B. Ölsorte, Filternummer" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> aktiv
        </label>
        <div className="flex gap-2">
          {task && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (confirm(`«${task.title}» aus dem Wartungsplan löschen? Die Journal-Einträge bleiben.`)) void deleteTask(task.id).then(() => onClose(true))
              }}
              className="rounded-lg border border-red-200 px-3 py-2 text-red-700"
            >
              Löschen
            </button>
          )}
          <button type="button" disabled={busy || !f.title.trim()} onClick={() => void save()} className="flex-1 rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50">
            Speichern
          </button>
        </div>
      </div>
    </Modal>
  )
}

type Dialog =
  | { kind: 'entry'; entry: MaintenanceLog | null; preselect?: string[]; type?: MaintenanceEntryType; title?: string }
  | { kind: 'task'; task: MaintenanceTask | null }

/** Status der Aufgaben einer Maschine, sortiert (fällig zuerst). */
export function machineStatuses(machine: Machine, tasks: MaintenanceTask[], log: MaintenanceLog[], tracks: TrackSpan[], today = todayIso()): TaskStatus[] {
  const own = log.filter((l) => l.machine_id === machine.id)
  return tasks
    .filter((t) => t.machine_id === machine.id && t.active && !t.deleted_at)
    .map((t) => taskStatus(t, { machine, log: own, tracks, today }))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.task.sort_order - b.task.sort_order)
}

/** Wartung einer Maschine: Zähler, Wartungsplan mit Fälligkeit, Journal. */
export default function MachineMaintenance({
  machine,
  tasks,
  log,
  tracks,
  canWrite,
  onChanged,
}: {
  machine: Machine
  tasks: MaintenanceTask[]
  log: MaintenanceLog[]
  tracks: TrackSpan[]
  canWrite: boolean
  onChanged: () => void
}) {
  const [dialog, setDialog] = useState<(Dialog & { seq: number }) | null>(null)
  const open = (d: Dialog) => setDialog((p) => ({ ...d, seq: (p?.seq ?? 0) + 1 }))
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const unit = counterUnit(machine)
  const own = log.filter((l) => l.machine_id === machine.id).sort((a, b) => b.done_date.localeCompare(a.done_date))
  const ownTasks = tasks.filter((t) => t.machine_id === machine.id && !t.deleted_at)
  const statuses = machineStatuses(machine, tasks, log, tracks)
  const inactive = ownTasks.filter((t) => !t.active)
  const counter = hasCounter(machine) ? latestCounter(own) : null
  const missingTemplate = (TEMPLATES[machine.kind] ?? []).filter((t) => !ownTasks.some((x) => x.template_key === t.key)).length
  const taskName = new Map(ownTasks.map((t) => [t.id, t.title]))
  const shownLog = showAll ? own : own.slice(0, 5)
  const close = (changed: boolean) => {
    setDialog(null)
    if (changed) onChanged()
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-gray-600">
          {hasCounter(machine) ? (
            counter ? (
              <>
                {unit === 'km' ? 'km-Stand' : 'Stundenzähler'} <b className="text-gray-800">{fmtNum(counter.value)} {unit}</b> am {fmtDate(counter.date)}
              </>
            ) : (
              <span className="text-amber-700">{unit === 'km' ? 'km-Stand' : 'Stundenzähler'} noch nie eingetragen</span>
            )
          ) : (
            <>Einsatzstunden aus GPS-Fahrten: {fmtNum(tracks.reduce((s, t) => s + (t.ended_at ? Date.parse(t.ended_at) - Date.parse(t.started_at) : 0), 0) / 3_600_000)} h</>
          )}
        </span>
        {canWrite && (
          <span className="flex flex-wrap gap-1">
            {hasCounter(machine) && (
              <button type="button" className={btn} onClick={() => open({ kind: 'entry', entry: null, type: 'zaehlerstand' })}>
                {unit === 'km' ? 'km-Stand' : 'Stunden'} eintragen
              </button>
            )}
            <button type="button" className={btn} onClick={() => open({ kind: 'entry', entry: null, type: 'reparatur' })}>
              + Eintrag
            </button>
          </span>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase text-gray-500">Wartungsplan</h3>
          {canWrite && (
            <span className="flex gap-1">
              {missingTemplate > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  className={btn}
                  onClick={() => {
                    setBusy(true)
                    void applyTemplate(machine, tasks)
                      .then(onChanged)
                      .finally(() => setBusy(false))
                  }}
                >
                  {ownTasks.length ? `+ ${missingTemplate} aus Vorlage` : 'Standard-Plan übernehmen'}
                </button>
              )}
              {statuses.length > 0 && statuses.every((s) => s.state === 'offen') && (
                <button
                  type="button"
                  className={btn}
                  title="Alle Aufgaben auf einmal als erledigt erfassen, z.B. am Tag des letzten Service — ab dann wird gerechnet"
                  onClick={() => open({ kind: 'entry', entry: null, preselect: statuses.map((s) => s.task.id), type: 'kontrolle', title: 'Ausgangslage' })}
                >
                  Ausgangslage erfassen
                </button>
              )}
              <button type="button" className={btn} onClick={() => open({ kind: 'task', task: null })}>
                + Aufgabe
              </button>
            </span>
          )}
        </div>
        {statuses.length === 0 ? (
          <p className="text-xs text-gray-500">Noch kein Wartungsplan.</p>
        ) : (
          <ul className="divide-y rounded border border-gray-100">
            {statuses.map((s) => (
              <li key={s.task.id} className="flex items-start gap-2 px-2 py-1.5">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_STYLE[s.state]}`}>{STATE_LABEL[s.state]}</span>
                <button type="button" disabled={!canWrite} onClick={() => open({ kind: 'task', task: s.task })} className="min-w-0 flex-1 text-left">
                  <span className="block text-gray-800">{s.task.title}</span>
                  <span className="block text-xs text-gray-500">
                    {intervalText(s.task, unit)}
                    {s.last ? ` · zuletzt ${fmtDate(s.last.done_date)}${s.last.counter != null ? ` bei ${fmtNum(s.last.counter)} ${unit}` : ''}` : ''}
                  </span>
                  <span className={`block text-xs ${s.state === 'faellig' ? 'text-red-700' : s.state === 'bald' ? 'text-amber-800' : 'text-gray-400'}`}>{dueText(s, unit)}</span>
                </button>
                {canWrite && (
                  <button type="button" className={`${btn} shrink-0`} onClick={() => open({ kind: 'entry', entry: null, preselect: [s.task.id], type: 'wartung' })}>
                    ✓ erledigt
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {inactive.length > 0 && <p className="mt-1 text-xs text-gray-400">Inaktiv: {inactive.map((t) => t.title).join(', ')}</p>}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-gray-500">Journal</h3>
        {own.length === 0 ? (
          <p className="text-xs text-gray-500">Noch keine Einträge.</p>
        ) : (
          <ul className="divide-y rounded border border-gray-100">
            {shownLog.map((l) => (
              <li key={l.id}>
                <button type="button" disabled={!canWrite} onClick={() => open({ kind: 'entry', entry: l })} className="w-full px-2 py-1.5 text-left">
                  <span className="flex justify-between gap-2">
                    <span className="text-gray-800">
                      {fmtDate(l.done_date)} · {ENTRY_LABEL[l.entry_type]}
                      {l.counter != null ? ` · ${fmtNum(l.counter)} ${unit}` : ''}
                    </span>
                    {l.cost_chf != null && <span className="shrink-0 text-gray-700">{chf(l.cost_chf)}</span>}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {[l.title, ...parseTaskIds(l.task_ids).map((id) => taskName.get(id) ?? 'gelöschte Aufgabe'), l.material, l.done_by, l.notes].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {own.length > 5 && (
          <button type="button" onClick={() => setShowAll(!showAll)} className="mt-1 text-xs text-brand-700">
            {showAll ? 'weniger' : `alle ${own.length} Einträge`}
          </button>
        )}
      </div>

      {dialog?.kind === 'entry' && (
        <EntryDialog
          key={dialog.seq}
          machine={machine}
          tasks={ownTasks.filter((t) => t.active)}
          entry={dialog.entry}
          preselect={dialog.preselect}
          type={dialog.type}
          title={dialog.title}
          onClose={close}
        />
      )}
      {dialog?.kind === 'task' && <TaskDialog key={dialog.seq} machine={machine} task={dialog.task} count={ownTasks.length} onClose={close} />}
    </div>
  )
}
