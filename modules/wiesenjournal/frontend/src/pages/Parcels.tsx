import { useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow } from '../db/write'
import { fmtArea } from '../lib/format'
import type { Intensitaet, Parcel } from '../types'

const CURRENT_YEAR = new Date().getFullYear()

async function loadParcels(pg: PGlite, seasonYear: number): Promise<Parcel[]> {
  const { rows } = await pg.query<Parcel>(
    'select * from parcels where season_year = $1 and deleted_at is null order by sort_order, name',
    [seasonYear],
  )
  return rows
}

const INTENSITAET_OPTIONS: { value: Intensitaet; label: string }[] = [
  { value: 'i', label: 'i — intensiv' },
  { value: 'wi', label: 'wi — wenig intensiv' },
  { value: 'mi', label: 'mi — mittel-intensiv' },
  { value: 'e', label: 'e — extensiv' },
]

interface FormState {
  id: string | null
  name: string
  area_a: string
  wiesentyp: string
  intensitaet: Intensitaet | ''
  notes: string
}

const EMPTY_FORM: FormState = { id: null, name: '', area_a: '', wiesentyp: '', intensitaet: '', notes: '' }

export default function Parcels() {
  const [seasonYear, setSeasonYear] = useState(CURRENT_YEAR)
  const { data, loading, refresh } = useQuery((pg) => loadParcels(pg, seasonYear), [seasonYear])
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)

  const parcels = data ?? []

  function openNew() {
    setForm({ ...EMPTY_FORM })
  }

  function openEdit(p: Parcel) {
    setForm({
      id: p.id,
      name: p.name,
      area_a: p.area_a == null ? '' : String(p.area_a),
      wiesentyp: p.wiesentyp ?? '',
      intensitaet: p.intensitaet ?? '',
      notes: p.notes ?? '',
    })
  }

  async function save() {
    if (!form || !form.name.trim()) return
    setSaving(true)
    try {
      const id = form.id ?? crypto.randomUUID()
      await upsertRow('parcels', {
        id,
        season_year: seasonYear,
        name: form.name.trim(),
        area_a: form.area_a ? Number(form.area_a) : null,
        wiesentyp: form.wiesentyp.trim() || null,
        intensitaet: form.intensitaet || null,
        base_geometry: null,
        sort_order: form.id ? undefined : parcels.length,
        notes: form.notes.trim() || null,
      } as never)
      setForm(null)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove(p: Parcel) {
    if (!confirm(`Parzelle "${p.name}" wirklich löschen?`)) return
    await softDeleteRow('parcels', p.id)
    refresh()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Parzellen {seasonYear}</h1>
        <div className="flex items-center gap-2">
          <select
            value={seasonYear}
            onChange={(e) => setSeasonYear(Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={openNew}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-700"
          >
            + Parzelle
          </button>
        </div>
      </div>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && parcels.length === 0 && (
        <p className="text-center text-gray-500">Noch keine Parzellen für {seasonYear} erfasst.</p>
      )}

      <ul className="space-y-2">
        {parcels.map((p) => (
          <li key={p.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-gray-800">{p.name}</div>
                <div className="mt-0.5 text-xs text-gray-500">
                  {fmtArea(p.area_a)}
                  {p.wiesentyp ? ` · ${p.wiesentyp}` : ''}
                  {p.intensitaet ? ` · ${p.intensitaet}` : ''}
                </div>
                {p.notes && <div className="mt-1 text-xs text-gray-400">{p.notes}</div>}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(p)}
                  className="rounded px-2 py-1 text-xs text-brand-700 active:bg-brand-50"
                >
                  Bearbeiten
                </button>
                <button
                  type="button"
                  onClick={() => remove(p)}
                  className="rounded px-2 py-1 text-xs text-red-600 active:bg-red-50"
                >
                  Löschen
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {form && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setForm(null)}>
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-xl bg-white p-4 shadow-lg sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold text-gray-800">{form.id ? 'Parzelle bearbeiten' : 'Neue Parzelle'}</h2>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Name / Schlag</span>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  autoFocus
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Aren</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.area_a}
                  onChange={(e) => setForm({ ...form, area_a: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Wiesentyp / Leitgras-Mischung</span>
                <input
                  type="text"
                  value={form.wiesentyp}
                  onChange={(e) => setForm({ ...form, wiesentyp: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Intensität</span>
                <select
                  value={form.intensitaet}
                  onChange={(e) => setForm({ ...form, intensitaet: e.target.value as Intensitaet })}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                >
                  <option value="">–</option>
                  {INTENSITAET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-gray-700">Bemerkung</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                  rows={2}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
                Abbrechen
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !form.name.trim()}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
