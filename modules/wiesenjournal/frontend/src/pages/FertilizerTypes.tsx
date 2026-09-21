import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import { useQuery } from '../hooks/useQuery'
import { upsertRow, softDeleteRow } from '../db/write'
import { loadFertilizerTypes } from '../lib/fertilization'
import Modal from '../components/Modal'
import type { DuengungUnit, FertilizerType } from '../types'

interface FormState {
  existing: FertilizerType | null
  code: string
  name: string
  unit: DuengungUnit
  n_kg_per_unit: string
  n_avail_pct: string
  p2o5_kg_per_unit: string
  k2o_kg_per_unit: string
  mg_kg_per_unit: string
  dilution_default: string
  container_label: string
  container_size: string
  active: boolean
  notes: string
}

function formFrom(t: FertilizerType | null): FormState {
  return {
    existing: t,
    code: t?.code ?? '',
    name: t?.name ?? '',
    unit: t?.unit ?? 'm3',
    n_kg_per_unit: t ? String(t.n_kg_per_unit) : '',
    n_avail_pct: t ? String(t.n_avail_pct) : '',
    p2o5_kg_per_unit: t ? String(t.p2o5_kg_per_unit) : '',
    k2o_kg_per_unit: t ? String(t.k2o_kg_per_unit) : '',
    mg_kg_per_unit: t?.mg_kg_per_unit == null ? '' : String(t.mg_kg_per_unit),
    dilution_default: t ? String(t.dilution_default) : '1',
    container_label: t?.container_label ?? '',
    container_size: t?.container_size == null ? '' : String(t.container_size),
    active: t?.active ?? true,
    notes: t?.notes ?? '',
  }
}

const UNIT_LABEL: Record<DuengungUnit, string> = { m3: 'm³', t: 't', kg: 'kg' }

export default function FertilizerTypes() {
  const { data, loading, refresh } = useQuery((pg) => loadFertilizerTypes(pg, false), [])
  const canWrite = useHasPermission('wiesenjournal:duengung:write')
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const types = data ?? []

  async function save() {
    if (!form || !form.code.trim() || !form.name.trim()) return
    setSaving(true)
    try {
      const n = (s: string) => (s.trim() === '' ? null : Number(s))
      await upsertRow('fertilizer_types', {
        ...(form.existing ?? { id: crypto.randomUUID(), legacy_code: null, sort_order: (types.length + 1) * 10 }),
        code: form.code.trim(),
        name: form.name.trim(),
        unit: form.unit,
        n_kg_per_unit: n(form.n_kg_per_unit) ?? 0,
        n_avail_pct: n(form.n_avail_pct) ?? 0,
        p2o5_kg_per_unit: n(form.p2o5_kg_per_unit) ?? 0,
        k2o_kg_per_unit: n(form.k2o_kg_per_unit) ?? 0,
        mg_kg_per_unit: n(form.mg_kg_per_unit),
        dilution_default: n(form.dilution_default) ?? 1,
        container_label: form.container_label.trim() || null,
        container_size: n(form.container_size),
        active: form.active,
        notes: form.notes.trim() || null,
      } as never)
      setForm(null)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  async function remove(t: FertilizerType) {
    if (!confirm(`Düngerart "${t.name}" löschen? Bestehende Massnahmen behalten ihre Werte.`)) return
    await softDeleteRow('fertilizer_types', t.id)
    refresh()
  }

  const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Düngerarten</h1>
          <p className="text-xs text-gray-500">
            Nährstoffgehalte je Einheit — Startwerte sind Richtwerte (ca. GRUD 2017), bitte für den Betrieb prüfen.
            Änderungen wirken auf neue Massnahmen; bestehende per „Neu berechnen" unter{' '}
            <Link to="../auswertung" className="text-brand-700 underline">
              Auswertung
            </Link>
            .
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setForm(formFrom(null))}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-700"
          >
            + Düngerart
          </button>
        )}
      </div>

      {loading && !data && <p className="text-center text-gray-400">Lädt…</p>}

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Einheit</th>
              <th className="px-3 py-2 text-right">kg N</th>
              <th className="px-3 py-2 text-right">% verf.</th>
              <th className="px-3 py-2 text-right">kg P₂O₅</th>
              <th className="px-3 py-2 text-right">kg K₂O</th>
              <th className="px-3 py-2">Gefäss</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className={`border-b last:border-0 ${t.active ? '' : 'text-gray-400'}`}>
                <td className="px-3 py-2 font-semibold">{t.code}</td>
                <td className="px-3 py-2">
                  {t.name}
                  {t.notes && <div className="text-[11px] text-gray-400">{t.notes}</div>}
                </td>
                <td className="px-3 py-2">
                  {UNIT_LABEL[t.unit]}
                  {t.unit === 'm3' && t.dilution_default !== 1 ? ` (Gülleanteil ${t.dilution_default})` : ''}
                </td>
                <td className="px-3 py-2 text-right">{t.n_kg_per_unit}</td>
                <td className="px-3 py-2 text-right">{t.n_avail_pct}</td>
                <td className="px-3 py-2 text-right">{t.p2o5_kg_per_unit}</td>
                <td className="px-3 py-2 text-right">{t.k2o_kg_per_unit}</td>
                <td className="px-3 py-2">
                  {t.container_label ? `${t.container_label}${t.container_size ? ` ${t.container_size} ${UNIT_LABEL[t.unit]}` : ''}` : '–'}
                </td>
                <td className="px-3 py-2 text-right">
                  {canWrite && (
                    <>
                      <button type="button" onClick={() => setForm(formFrom(t))} className="px-2 text-xs text-brand-700">
                        Bearbeiten
                      </button>
                      <button type="button" onClick={() => remove(t)} className="px-2 text-xs text-red-600">
                        Löschen
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title={form.existing ? 'Düngerart bearbeiten' : 'Neue Düngerart'} onClose={() => setForm(null)}>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Code
              <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              Einheit
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as DuengungUnit })} className={field}>
                <option value="m3">m³</option>
                <option value="t">t</option>
                <option value="kg">kg</option>
              </select>
            </label>
            <label className="col-span-2 text-sm">
              Name
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              kg N je {UNIT_LABEL[form.unit]}
              <input type="number" step="0.001" value={form.n_kg_per_unit} onChange={(e) => setForm({ ...form, n_kg_per_unit: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              davon verfügbar %
              <input type="number" step="1" value={form.n_avail_pct} onChange={(e) => setForm({ ...form, n_avail_pct: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              kg P₂O₅ je {UNIT_LABEL[form.unit]}
              <input type="number" step="0.001" value={form.p2o5_kg_per_unit} onChange={(e) => setForm({ ...form, p2o5_kg_per_unit: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              kg K₂O je {UNIT_LABEL[form.unit]}
              <input type="number" step="0.001" value={form.k2o_kg_per_unit} onChange={(e) => setForm({ ...form, k2o_kg_per_unit: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              kg Mg je {UNIT_LABEL[form.unit]}
              <input type="number" step="0.001" value={form.mg_kg_per_unit} onChange={(e) => setForm({ ...form, mg_kg_per_unit: e.target.value })} className={field} />
            </label>
            <label className="text-sm" title="Gülle-Anteil im ausgebrachten Volumen, auf den sich die Werte beziehen: 1:1 verdünnt = 0.5, unverdünnt = 1">
              Gülleanteil (Basis)
              <input type="number" step="0.05" min="0.05" max="1" value={form.dilution_default} onChange={(e) => setForm({ ...form, dilution_default: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              Gefäss (Fass/Fuder)
              <input type="text" value={form.container_label} onChange={(e) => setForm({ ...form, container_label: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              Gefäss-Inhalt ({UNIT_LABEL[form.unit]})
              <input type="number" step="0.1" value={form.container_size} onChange={(e) => setForm({ ...form, container_size: e.target.value })} className={field} />
            </label>
            <label className="col-span-2 text-sm">
              Bemerkung / Quelle
              <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={field} />
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              aktiv (in der Auswahl sichtbar)
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Abbrechen
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !form.code.trim() || !form.name.trim()}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
