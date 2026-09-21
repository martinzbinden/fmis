import { useEffect, useState } from 'react'
import { getDb } from '../db/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import Modal from './Modal'
import { loadParcelNutrientTotals } from '../lib/fertilization'
import { kgPerHa } from '../lib/nutrients'
import type { NDoseSummary } from '../types'

interface Row {
  id: string | null
  gabe_number: string
  guelle_verduennung: string
  n_planned_kg: string
  n_actual_kg: string
}

function rowFromEntry(e: NDoseSummary): Row {
  return {
    id: e.id,
    gabe_number: String(e.gabe_number),
    guelle_verduennung: e.guelle_verduennung ?? '',
    n_planned_kg: e.n_planned_kg == null ? '' : String(e.n_planned_kg),
    n_actual_kg: e.n_actual_kg == null ? '' : String(e.n_actual_kg),
  }
}

export default function GabenPanel({
  parcelId,
  parcelName,
  parcelAreaA,
  seasonYear,
  onClose,
}: {
  parcelId: string
  parcelName: string
  parcelAreaA: number | null
  seasonYear: number
  onClose: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<{ n_kg: number; n_avail_kg: number; p2o5_kg: number; k2o_kg: number; applications: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function reload() {
    const pg = await getDb()
    const { rows: entries } = await pg.query<NDoseSummary>(
      'select * from n_dose_summary where parcel_id = $1 and season_year = $2 and deleted_at is null order by gabe_number',
      [parcelId, seasonYear],
    )
    setRows(entries.map(rowFromEntry))
    setTotals(await loadParcelNutrientTotals(pg, parcelId, seasonYear))
    setLoading(false)
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelId, seasonYear])

  function addRow() {
    const nextNumber = rows.length ? Math.max(...rows.map((r) => Number(r.gabe_number) || 0)) + 1 : 1
    setRows((rs) => [...rs, { id: null, gabe_number: String(nextNumber), guelle_verduennung: '', n_planned_kg: '', n_actual_kg: '' }])
  }

  function update(idx: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  async function remove(idx: number) {
    const row = rows[idx]
    if (row.id) await softDeleteRow('n_dose_summary', row.id)
    setRows((rs) => rs.filter((_, i) => i !== idx))
  }

  async function saveAll() {
    setSaving(true)
    try {
      for (const row of rows) {
        if (!row.gabe_number) continue
        await upsertRow('n_dose_summary', {
          id: row.id ?? crypto.randomUUID(),
          parcel_id: parcelId,
          season_year: seasonYear,
          gabe_number: Number(row.gabe_number),
          guelle_verduennung: row.guelle_verduennung.trim() || null,
          n_planned_kg: row.n_planned_kg ? Number(row.n_planned_kg) : null,
          n_actual_kg: row.n_actual_kg ? Number(row.n_actual_kg) : null,
          notes: null,
        } as never)
      }
      await reload()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Gaben · ${parcelName} (${seasonYear})`} onClose={onClose}>
      {loading ? (
        <p className="py-4 text-center text-gray-400">Lädt…</p>
      ) : (
        <div className="space-y-3">
          {totals && (
            <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Nährstoffe aus den Massnahmen {seasonYear}</div>
              <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                <div>N gesamt <b>{totals.n_kg.toFixed(1)} kg</b></div>
                <div>N verfügbar <b>{totals.n_avail_kg.toFixed(1)} kg</b></div>
                <div>P₂O₅ <b>{totals.p2o5_kg.toFixed(1)} kg</b></div>
                <div>K₂O <b>{totals.k2o_kg.toFixed(1)} kg</b></div>
              </div>
              <div className="mt-1 text-xs text-brand-800">
                {totals.applications} Massnahme{totals.applications === 1 ? '' : 'n'}
                {parcelAreaA ? ` · ${kgPerHa(totals.n_kg, parcelAreaA)} kg N/ha (${kgPerHa(totals.n_avail_kg, parcelAreaA)} verfügbar) auf ${parcelAreaA} a` : ''}
              </div>
            </div>
          )}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="pb-1 pr-1">Gabe</th>
                <th className="pb-1 pr-1">Verdünnung</th>
                <th className="pb-1 pr-1">N geplant (kg)</th>
                <th className="pb-1 pr-1">N effektiv (kg)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  <td className="pr-1 py-0.5">
                    <input
                      type="number"
                      value={row.gabe_number}
                      onChange={(e) => update(idx, { gabe_number: e.target.value })}
                      className="w-12 rounded border border-gray-300 px-1 py-1"
                    />
                  </td>
                  <td className="pr-1 py-0.5">
                    <input
                      type="text"
                      placeholder="1:1"
                      value={row.guelle_verduennung}
                      onChange={(e) => update(idx, { guelle_verduennung: e.target.value })}
                      className="w-16 rounded border border-gray-300 px-1 py-1"
                    />
                  </td>
                  <td className="pr-1 py-0.5">
                    <input
                      type="number"
                      step="0.01"
                      value={row.n_planned_kg}
                      onChange={(e) => update(idx, { n_planned_kg: e.target.value })}
                      className="w-16 rounded border border-gray-300 px-1 py-1"
                    />
                  </td>
                  <td className="pr-1 py-0.5">
                    <input
                      type="number"
                      step="0.01"
                      value={row.n_actual_kg}
                      onChange={(e) => update(idx, { n_actual_kg: e.target.value })}
                      className="w-16 rounded border border-gray-300 px-1 py-1"
                    />
                  </td>
                  <td>
                    <button type="button" onClick={() => remove(idx)} className="px-1 text-red-500">
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={addRow} className="text-xs font-medium text-brand-700">
            + Gabe hinzufügen
          </button>
          <div className="flex justify-end gap-2 border-t pt-3">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Schliessen
            </button>
            <button
              type="button"
              onClick={saveAll}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Speichern
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
