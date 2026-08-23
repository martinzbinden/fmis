import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow } from '../db/write'
import { fmtDate, todayIso } from '../lib/format'
import type { MedicationReference as MedicationReferenceRow } from '../types'

async function loadReferences(pg: PGlite): Promise<MedicationReferenceRow[]> {
  const { rows } = await pg.query<MedicationReferenceRow>(
    'select * from medication_reference where deleted_at is null order by name',
  )
  return rows
}

function lookupUrl(name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:tierarzneimittel.ch ${name}`)}`
}

export default function MedicationReference() {
  const { data, loading, refresh } = useQuery(loadReferences)
  const references = data ?? []

  const [name, setName] = useState('')
  const [activeIngredient, setActiveIngredient] = useState('')
  const [withdrawalDays, setWithdrawalDays] = useState('0')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<MedicationReferenceRow>>({})

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!name) return
    setSaving(true)
    try {
      await upsertRow('medication_reference', {
        id: crypto.randomUUID(),
        name,
        active_ingredient: activeIngredient || null,
        default_withdrawal_days: Number(withdrawalDays) || 0,
        notes: notes || null,
        verified_at: todayIso(),
      })
      setName('')
      setActiveIngredient('')
      setWithdrawalDays('0')
      setNotes('')
      refresh()
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit(r: MedicationReferenceRow) {
    await upsertRow('medication_reference', { ...r, ...editForm })
    setEditingId(null)
    refresh()
  }

  async function markVerified(r: MedicationReferenceRow) {
    await upsertRow('medication_reference', { ...r, verified_at: todayIso() })
    refresh()
  }

  async function deleteReference(r: MedicationReferenceRow) {
    if (!confirm(`"${r.name}" wirklich löschen?`)) return
    await softDeleteRow('medication_reference', r.id)
    refresh()
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <div>
        <Link to="/medikamente" className="text-sm text-brand-700">
          ← Medikamente erfassen
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-800">Medikamenten-Referenz</h1>
        <p className="mt-1 text-xs text-gray-500">
          Lokal von dir gepflegte Liste — es gibt keine automatisch aktualisierte offizielle
          Schnittstelle. Über den Link kannst du den aktuellen Wert jederzeit auf
          tierarzneimittel.ch gegenprüfen.
        </p>
      </div>

      <form onSubmit={handleAdd} className="space-y-3 rounded-lg bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-600">Neu hinzufügen</h2>
        <input
          type="text"
          placeholder="Medikamentenname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
        <input
          type="text"
          placeholder="Wirkstoff (optional)"
          value={activeIngredient}
          onChange={(e) => setActiveIngredient(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Absetzfrist (Tage)</span>
          <input
            type="number"
            inputMode="numeric"
            value={withdrawalDays}
            onChange={(e) => setWithdrawalDays(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </label>
        <input
          type="text"
          placeholder="Notizen (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={saving || !name}
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
                value={editForm.name ?? r.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded border border-gray-300 px-2 py-1"
                placeholder="Name"
              />
              <input
                type="text"
                value={editForm.active_ingredient ?? r.active_ingredient ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, active_ingredient: e.target.value || null }))}
                className="w-full rounded border border-gray-300 px-2 py-1"
                placeholder="Wirkstoff"
              />
              <input
                type="number"
                value={editForm.default_withdrawal_days ?? r.default_withdrawal_days}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, default_withdrawal_days: Number(e.target.value) }))
                }
                className="w-24 rounded border border-gray-300 px-2 py-1"
                placeholder="Absetzfrist (Tage)"
              />
              <input
                type="text"
                value={editForm.notes ?? r.notes ?? ''}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value || null }))}
                className="w-full rounded border border-gray-300 px-2 py-1"
                placeholder="Notizen"
              />
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
                  {r.active_ingredient && <div className="text-gray-500">{r.active_ingredient}</div>}
                  <div className="text-gray-700">{r.default_withdrawal_days} Tage Absetzfrist</div>
                  {r.notes && <div className="text-gray-500">{r.notes}</div>}
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
                  <button
                    type="button"
                    onClick={() => {
                      setEditForm(r)
                      setEditingId(r.id)
                    }}
                    className="text-brand-700"
                  >
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
