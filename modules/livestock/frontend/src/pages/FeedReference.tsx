import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow } from '../db/write'
import { fmtDate, todayIso } from '../lib/format'
import type { FeedReference as FeedReferenceRow } from '../types'

async function loadReferences(pg: PGlite): Promise<FeedReferenceRow[]> {
  const { rows } = await pg.query<FeedReferenceRow>(
    'select * from feed_reference where deleted_at is null order by name',
  )
  return rows
}

function lookupUrl(name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} Futtermittel Gehalte Deklaration`)}`
}

interface FormState {
  name: string
  supplier: string
  crude_protein_pct: string
  energy_mj: string
  crude_fiber_pct: string
  crude_ash_pct: string
  crude_fat_pct: string
  calcium_pct: string
  phosphorus_pct: string
  sodium_pct: string
  notes: string
}

const emptyForm: FormState = {
  name: '',
  supplier: '',
  crude_protein_pct: '',
  energy_mj: '',
  crude_fiber_pct: '',
  crude_ash_pct: '',
  crude_fat_pct: '',
  calcium_pct: '',
  phosphorus_pct: '',
  sodium_pct: '',
  notes: '',
}

function num(v: string): number | null {
  return v.trim() === '' ? null : Number(v)
}

function GehalteFields({
  value,
  onChange,
}: {
  value: FormState
  onChange: (patch: Partial<FormState>) => void
}) {
  return (
    <>
      <input
        type="text"
        placeholder="Lieferant (optional)"
        value={value.supplier}
        onChange={(e) => onChange({ supplier: e.target.value })}
        className="w-full rounded border border-gray-300 px-3 py-2"
      />
      <div className="grid grid-cols-2 gap-2">
        <LabeledNumber label="Rohprotein %" value={value.crude_protein_pct} onChange={(v) => onChange({ crude_protein_pct: v })} />
        <LabeledNumber label="Energie (MJ)" value={value.energy_mj} onChange={(v) => onChange({ energy_mj: v })} />
        <LabeledNumber label="Rohfaser %" value={value.crude_fiber_pct} onChange={(v) => onChange({ crude_fiber_pct: v })} />
        <LabeledNumber label="Rohasche %" value={value.crude_ash_pct} onChange={(v) => onChange({ crude_ash_pct: v })} />
        <LabeledNumber label="Rohfett %" value={value.crude_fat_pct} onChange={(v) => onChange({ crude_fat_pct: v })} />
        <LabeledNumber label="Calcium %" value={value.calcium_pct} onChange={(v) => onChange({ calcium_pct: v })} />
        <LabeledNumber label="Phosphor %" value={value.phosphorus_pct} onChange={(v) => onChange({ phosphorus_pct: v })} />
        <LabeledNumber label="Natrium %" value={value.sodium_pct} onChange={(v) => onChange({ sodium_pct: v })} />
      </div>
      <input
        type="text"
        placeholder="Notizen (optional)"
        value={value.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        className="w-full rounded border border-gray-300 px-3 py-2"
      />
    </>
  )
}

function LabeledNumber({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
      />
    </label>
  )
}

export default function FeedReference() {
  const { data, loading, refresh } = useQuery(loadReferences)
  const references = data ?? []

  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(emptyForm)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name) return
    setSaving(true)
    try {
      await upsertRow('feed_reference', {
        id: crypto.randomUUID(),
        name: form.name,
        supplier: form.supplier || null,
        crude_protein_pct: num(form.crude_protein_pct),
        energy_mj: num(form.energy_mj),
        crude_fiber_pct: num(form.crude_fiber_pct),
        crude_ash_pct: num(form.crude_ash_pct),
        crude_fat_pct: num(form.crude_fat_pct),
        calcium_pct: num(form.calcium_pct),
        phosphorus_pct: num(form.phosphorus_pct),
        sodium_pct: num(form.sodium_pct),
        notes: form.notes || null,
        verified_at: todayIso(),
      })
      setForm(emptyForm)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  function startEdit(r: FeedReferenceRow) {
    setEditForm({
      name: r.name,
      supplier: r.supplier ?? '',
      crude_protein_pct: r.crude_protein_pct?.toString() ?? '',
      energy_mj: r.energy_mj?.toString() ?? '',
      crude_fiber_pct: r.crude_fiber_pct?.toString() ?? '',
      crude_ash_pct: r.crude_ash_pct?.toString() ?? '',
      crude_fat_pct: r.crude_fat_pct?.toString() ?? '',
      calcium_pct: r.calcium_pct?.toString() ?? '',
      phosphorus_pct: r.phosphorus_pct?.toString() ?? '',
      sodium_pct: r.sodium_pct?.toString() ?? '',
      notes: r.notes ?? '',
    })
    setEditingId(r.id)
  }

  async function saveEdit(r: FeedReferenceRow) {
    await upsertRow('feed_reference', {
      ...r,
      name: editForm.name,
      supplier: editForm.supplier || null,
      crude_protein_pct: num(editForm.crude_protein_pct),
      energy_mj: num(editForm.energy_mj),
      crude_fiber_pct: num(editForm.crude_fiber_pct),
      crude_ash_pct: num(editForm.crude_ash_pct),
      crude_fat_pct: num(editForm.crude_fat_pct),
      calcium_pct: num(editForm.calcium_pct),
      phosphorus_pct: num(editForm.phosphorus_pct),
      sodium_pct: num(editForm.sodium_pct),
      notes: editForm.notes || null,
    })
    setEditingId(null)
    refresh()
  }

  async function markVerified(r: FeedReferenceRow) {
    await upsertRow('feed_reference', { ...r, verified_at: todayIso() })
    refresh()
  }

  async function deleteReference(r: FeedReferenceRow) {
    if (!confirm(`"${r.name}" wirklich löschen?`)) return
    await softDeleteRow('feed_reference', r.id)
    refresh()
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <div>
        <Link to="/futter" className="text-sm text-brand-700">
          ← Futter erfassen
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-800">Futtermittel-Referenz</h1>
        <p className="mt-1 text-xs text-gray-500">
          Lokal von dir gepflegte Liste — keine automatisch aktualisierte offizielle
          Schnittstelle verfügbar. Über den Link kannst du die Gehalte beim Hersteller
          gegenprüfen.
        </p>
      </div>

      <form onSubmit={handleAdd} className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-600">Neu hinzufügen</h2>
        <input
          type="text"
          placeholder="Produktname, z.B. UFA 867"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
        <GehalteFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        <button
          type="submit"
          disabled={saving || !form.name}
          className="w-full rounded-lg bg-brand-700 py-2.5 font-semibold text-white disabled:opacity-50"
        >
          Hinzufügen
        </button>
      </form>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && references.length === 0 && (
        <p className="text-center text-gray-500">Noch keine Referenzeinträge.</p>
      )}

      <ul className="space-y-2">
        {references.map((r) =>
          editingId === r.id ? (
            <li key={r.id} className="space-y-2 rounded-lg bg-white p-3 shadow-sm text-sm">
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1"
                placeholder="Name"
              />
              <GehalteFields value={editForm} onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => saveEdit(r)}
                  className="rounded bg-brand-700 px-3 py-1 text-white"
                >
                  Speichern
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="rounded border border-gray-300 px-3 py-1 text-gray-700"
                >
                  Abbrechen
                </button>
              </div>
            </li>
          ) : (
            <li key={r.id} className="rounded-lg bg-white p-3 shadow-sm text-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-gray-800">{r.name}</div>
                  {r.supplier && <div className="text-gray-500">{r.supplier}</div>}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600">
                    {r.crude_protein_pct != null && <span>Rohprotein {r.crude_protein_pct}%</span>}
                    {r.energy_mj != null && <span>Energie {r.energy_mj} MJ</span>}
                    {r.crude_fiber_pct != null && <span>Rohfaser {r.crude_fiber_pct}%</span>}
                    {r.crude_ash_pct != null && <span>Rohasche {r.crude_ash_pct}%</span>}
                    {r.crude_fat_pct != null && <span>Rohfett {r.crude_fat_pct}%</span>}
                    {r.calcium_pct != null && <span>Ca {r.calcium_pct}%</span>}
                    {r.phosphorus_pct != null && <span>P {r.phosphorus_pct}%</span>}
                    {r.sodium_pct != null && <span>Na {r.sodium_pct}%</span>}
                  </div>
                  {r.notes && <div className="mt-1 text-gray-500">{r.notes}</div>}
                  <div className="mt-1 text-xs text-gray-400">
                    {r.verified_at ? `zuletzt geprüft ${fmtDate(r.verified_at)}` : 'noch nie geprüft'}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                  <a
                    href={lookupUrl(r.name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-700"
                  >
                    🔗 nachschlagen
                  </a>
                  <button type="button" onClick={() => markVerified(r)} className="text-brand-700">
                    als geprüft markieren
                  </button>
                  <button type="button" onClick={() => startEdit(r)} className="text-brand-700">
                    Bearbeiten
                  </button>
                  <button type="button" onClick={() => deleteReference(r)} className="text-red-600">
                    Löschen
                  </button>
                </div>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
