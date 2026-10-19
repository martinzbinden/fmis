import { useState } from 'react'
import AsyncButton from '@fmis/core/AsyncButton'
import Modal from './Modal'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_ORDER } from '../lib/categories'
import { saveProject } from '../lib/data'
import type { Project, ProjectStatus } from '../types'

const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-base'
const label = 'mb-1 block text-xs font-medium text-gray-700'

/** Projekt anlegen oder bearbeiten. */
export default function ProjectForm({
  project,
  onClose,
  onSaved,
  onDelete,
}: {
  project: Project | null
  onClose: () => void
  onSaved: (id: string) => void
  onDelete?: () => void
}) {
  const [f, setF] = useState({
    name: project?.name ?? '',
    description: project?.description ?? '',
    status: (project?.status ?? 'idee') as ProjectStatus,
    location: project?.location ?? '',
    start_date: project?.start_date ?? '',
    end_date: project?.end_date ?? '',
    contractor: project?.contractor ?? '',
    notes: project?.notes ?? '',
  })
  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }))
  const save = async () => {
    if (!f.name.trim()) throw new Error('Bitte einen Namen eingeben.')
    const id = await saveProject(
      {
        name: f.name.trim(),
        description: f.description.trim() || null,
        status: f.status,
        location: f.location.trim() || null,
        start_date: f.start_date || null,
        end_date: f.end_date || null,
        contractor: f.contractor.trim() || null,
        notes: f.notes.trim() || null,
      },
      project ?? undefined,
    )
    onSaved(id)
  }
  return (
    <Modal title={project ? 'Projekt bearbeiten' : 'Neues Projekt'} onClose={onClose} onSubmit={() => void save().catch(() => {})}>
      <div className="space-y-3">
        <label className="block">
          <span className={label}>Name</span>
          <input className={field} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="z.B. Gülleleitung Riedacker" />
        </label>
        <div>
          <span className={label}>Status</span>
          <div className="flex flex-wrap gap-2">
            {PROJECT_STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set({ status: s })}
                className={`min-h-11 rounded-full border px-3 text-sm ${f.status === s ? 'border-brand-600 bg-brand-100 font-semibold text-brand-800' : 'border-gray-300 text-gray-700'}`}
              >
                {PROJECT_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className={label}>Ort</span>
          <input className={field} value={f.location} onChange={(e) => set({ location: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={label}>Baubeginn</span>
            <input type="date" className={field} value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </label>
          <label className="block">
            <span className={label}>Fertig bis</span>
            <input type="date" className={field} value={f.end_date} onChange={(e) => set({ end_date: e.target.value })} />
          </label>
        </div>
        <label className="block">
          <span className={label}>Ausführende Firma</span>
          <input className={field} value={f.contractor} onChange={(e) => set({ contractor: e.target.value })} />
        </label>
        <label className="block">
          <span className={label}>Beschreibung</span>
          <textarea className={field} rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
        <label className="block">
          <span className={label}>Notizen</span>
          <textarea className={field} rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          {onDelete ? (
            <button type="button" onClick={onDelete} className="min-h-12 rounded-lg px-3 text-sm text-red-700">
              Projekt löschen
            </button>
          ) : (
            <span />
          )}
          <AsyncButton onClick={save} className="min-h-12 rounded-lg bg-brand-600 px-5 text-base font-medium text-white disabled:opacity-50">
            Speichern
          </AsyncButton>
        </div>
      </div>
    </Modal>
  )
}
