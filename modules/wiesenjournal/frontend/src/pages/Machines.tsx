import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow } from '../db/write'
import { loadMachines, MACHINE_KIND_LABEL } from '../lib/machines'
import Modal from '../components/Modal'
import type { DuengungUnit, Machine, MachineKind } from '../types'

interface FormState {
  existing: Machine | null
  name: string
  kind: MachineKind
  capacity: string
  capacity_unit: DuengungUnit | ''
  width_m: string
  active: boolean
  notes: string
}

function formFrom(m: Machine | null): FormState {
  return {
    existing: m,
    name: m?.name ?? '',
    kind: m?.kind ?? 'guellefass',
    capacity: m?.capacity == null ? '' : String(m.capacity),
    capacity_unit: m?.capacity_unit ?? (m ? '' : 'm3'),
    width_m: m?.width_m == null ? '' : String(m.width_m),
    active: m?.active ?? true,
    notes: m?.notes ?? '',
  }
}

const UNIT_LABEL: Record<DuengungUnit, string> = { m3: 'm³', t: 't', kg: 'kg' }

/** Maschinenliste: Fassgrösse/Ladevolumen und Arbeitsbreite für Arbeitsplan
 * und GPS-Aufzeichnung (schema/0015_machines.sql). */
export default function Machines() {
  const { data, loading, refresh } = useQuery((pg) => loadMachines(pg, false), [])
  const canWrite = useHasPermission('wiesenjournal:tracking:write')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const machines = data ?? []

  async function save() {
    if (!form || !form.name.trim()) return
    setSaving(true)
    try {
      const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
      await upsertRow('machines', {
        ...(form.existing ?? { id: crypto.randomUUID(), sort_order: (machines.length + 1) * 10 }),
        name: form.name.trim(),
        kind: form.kind,
        capacity: n(form.capacity),
        capacity_unit: n(form.capacity) == null ? null : form.capacity_unit || null,
        width_m: n(form.width_m),
        active: form.active,
        notes: form.notes.trim() || null,
      } as never)
      setForm(null)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove(m: Machine) {
    if (!confirm(`Maschine "${m.name}" löschen? Bisherige Spuren behalten den Namen.`)) return
    await softDeleteRow('machines', m.id)
    refresh()
  }

  const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="../arbeitsplan" className="text-sm text-brand-700">
            ← Arbeitsplan
          </Link>
          <h1 className="text-xl font-bold text-gray-800">Maschinen</h1>
          <p className="text-xs text-gray-500">
            Fassgrösse bzw. Ladevolumen (für die Anzahl Fässer im Arbeitsplan) und Arbeitsbreite (für die GPS-Spur).
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setForm(formFrom(null))}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-700"
          >
            + Maschine
          </button>
        )}
      </div>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && machines.length === 0 && <p className="text-center text-sm text-gray-500">Noch keine Maschinen erfasst.</p>}

      <ul className="space-y-2">
        {machines.map((m) => (
          <li key={m.id} className={`flex items-center justify-between gap-3 rounded-lg bg-white p-3 shadow-sm ${m.active ? '' : 'opacity-50'}`}>
            <div className="min-w-0">
              <div className="font-semibold text-gray-800">{m.name}</div>
              <div className="text-xs text-gray-500">
                {MACHINE_KIND_LABEL[m.kind] ?? m.kind}
                {m.capacity != null && m.capacity_unit ? ` · ${m.capacity} ${UNIT_LABEL[m.capacity_unit]}` : ''}
                {m.width_m != null ? ` · Arbeitsbreite ${m.width_m} m` : ''}
                {!m.active && ' · nicht aktiv'}
              </div>
              {m.notes && <div className="text-xs text-gray-400">{m.notes}</div>}
            </div>
            {canWrite && (
              <div className="flex shrink-0 gap-1">
                <button type="button" onClick={() => setForm(formFrom(m))} className="rounded border border-gray-300 px-2 py-1 text-xs">
                  Bearbeiten
                </button>
                <button type="button" onClick={() => void remove(m)} className="rounded border border-gray-300 px-2 py-1 text-xs text-red-700">
                  Löschen
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {form && (
        <Modal title={form.existing ? 'Maschine bearbeiten' : 'Neue Maschine'} onClose={() => setForm(null)}>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">Bezeichnung</span>
              <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z.B. Güllefass Fliegl 6.5 m³" />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">Art</span>
              <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as MachineKind })}>
                {Object.entries(MACHINE_KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block font-medium text-gray-700">Fass / Ladevolumen</span>
                <input className={field} inputMode="decimal" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-gray-700">Einheit</span>
                <select
                  className={field}
                  value={form.capacity_unit}
                  onChange={(e) => setForm({ ...form, capacity_unit: e.target.value as DuengungUnit | '' })}
                >
                  <option value="">–</option>
                  <option value="m3">m³</option>
                  <option value="t">t</option>
                  <option value="kg">kg</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">Arbeitsbreite (m)</span>
              <input className={field} inputMode="decimal" value={form.width_m} onChange={(e) => setForm({ ...form, width_m: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-gray-700">Bemerkung</span>
              <input className={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="z.B. Schleppschuhverteiler" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              aktiv (in Auswahllisten)
            </label>
            <button
              type="button"
              disabled={saving || !form.name.trim()}
              onClick={() => void save()}
              className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
