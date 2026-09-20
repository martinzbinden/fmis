import { useEffect, useState } from 'react'
import { getDb } from '../db/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import { loadDayEntries } from '../lib/journalEntry'
import { DUENGUNG_CODES, fmtDate } from '../lib/format'
import Modal from './Modal'
import type { DuengungCode, DuengungUnit, FertilizationEntry, UsageEntry, UsageType } from '../types'

interface FertRow {
  id: string | null
  duengung_code: DuengungCode
  amount: string
  unit: DuengungUnit
  gabe_number: string
}

function fertRowFromEntry(e: FertilizationEntry): FertRow {
  return {
    id: e.id,
    duengung_code: e.duengung_code,
    amount: e.amount == null ? '' : String(e.amount),
    unit: e.unit,
    gabe_number: e.gabe_number == null ? '' : String(e.gabe_number),
  }
}

const EMPTY_FERT_ROW: FertRow = { id: null, duengung_code: 'RGv', amount: '', unit: 'm3', gabe_number: '' }

export default function DayEntryEditor({
  parcelId,
  parcelName,
  date,
  onClose,
  onSaved,
}: {
  parcelId: string
  parcelName: string
  date: string
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [existingUsage, setExistingUsage] = useState<UsageEntry | null>(null)
  const [usageType, setUsageType] = useState<UsageType | ''>('')
  const [animalCount, setAnimalCount] = useState('')
  const [animalGroup, setAnimalGroup] = useState('')
  const [usageNotes, setUsageNotes] = useState('')

  const [fertRows, setFertRows] = useState<FertRow[]>([])
  const [removedFertIds, setRemovedFertIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pg = await getDb()
      const { usage, fertilizations } = await loadDayEntries(pg, parcelId, date)
      if (cancelled) return
      const u = usage[0] ?? null
      setExistingUsage(u)
      setUsageType(u?.usage_type ?? '')
      setAnimalCount(u?.animal_count == null ? '' : String(u.animal_count))
      setAnimalGroup(u?.animal_group ?? '')
      setUsageNotes(u?.notes ?? '')
      setFertRows(fertilizations.map(fertRowFromEntry))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [parcelId, date])

  function addFertRow() {
    setFertRows((rows) => [...rows, { ...EMPTY_FERT_ROW }])
  }

  function updateFertRow(idx: number, patch: Partial<FertRow>) {
    setFertRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function removeFertRow(idx: number) {
    setFertRows((rows) => {
      const row = rows[idx]
      if (row.id) setRemovedFertIds((ids) => [...ids, row.id!])
      return rows.filter((_, i) => i !== idx)
    })
  }

  async function save() {
    setSaving(true)
    try {
      if (usageType) {
        await upsertRow('usage_entries', {
          id: existingUsage?.id ?? crypto.randomUUID(),
          parcel_id: parcelId,
          entry_date: date,
          usage_type: usageType,
          animal_count: usageType === 'weide_anzahl' && animalCount ? Number(animalCount) : null,
          animal_group: animalGroup.trim() || null,
          paddock_version_id: existingUsage?.paddock_version_id ?? null,
          notes: usageNotes.trim() || null,
        } as never)
      } else if (existingUsage) {
        await softDeleteRow('usage_entries', existingUsage.id)
      }

      for (const id of removedFertIds) {
        await softDeleteRow('fertilization_entries', id)
      }
      for (const row of fertRows) {
        if (!row.amount && !row.gabe_number) continue
        await upsertRow('fertilization_entries', {
          id: row.id ?? crypto.randomUUID(),
          parcel_id: parcelId,
          entry_date: date,
          duengung_code: row.duengung_code,
          amount: row.amount ? Number(row.amount) : null,
          unit: row.unit,
          gabe_number: row.gabe_number ? Number(row.gabe_number) : null,
          notes: null,
        } as never)
      }

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`${parcelName} · ${fmtDate(date)}`} onClose={onClose}>
      {loading ? (
        <p className="py-4 text-center text-gray-400">Lädt…</p>
      ) : (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-sm font-bold text-gray-700">Nutzung</h3>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { value: '', label: 'Keine' },
                    { value: 'weide', label: 'Weide' },
                    { value: 'weide_anzahl', label: 'Weide (Anzahl Tiere)' },
                    { value: 'eingrasen', label: 'Eingrasen' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setUsageType(opt.value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${
                      usageType === opt.value
                        ? 'border-brand-600 bg-brand-100 text-brand-800'
                        : 'border-gray-300 text-gray-600'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {usageType === 'weide_anzahl' && (
                <input
                  type="number"
                  placeholder="Anzahl Tiere"
                  value={animalCount}
                  onChange={(e) => setAnimalCount(e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
              )}
              {usageType && (
                <>
                  <input
                    type="text"
                    placeholder="Tiergruppe (z.B. 12 Milchkühe)"
                    value={animalGroup}
                    onChange={(e) => setAnimalGroup(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="Bemerkung"
                    value={usageNotes}
                    onChange={(e) => setUsageNotes(e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                </>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700">Düngung</h3>
              <button type="button" onClick={addFertRow} className="text-xs font-medium text-brand-700">
                + Gabe
              </button>
            </div>
            <div className="space-y-2">
              {fertRows.map((row, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <select
                    value={row.duengung_code}
                    onChange={(e) => updateFertRow(idx, { duengung_code: e.target.value as DuengungCode })}
                    className="rounded border border-gray-300 px-1.5 py-1.5 text-xs"
                  >
                    {DUENGUNG_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Menge"
                    value={row.amount}
                    onChange={(e) => updateFertRow(idx, { amount: e.target.value })}
                    className="w-20 rounded border border-gray-300 px-1.5 py-1.5 text-xs"
                  />
                  <select
                    value={row.unit}
                    onChange={(e) => updateFertRow(idx, { unit: e.target.value as DuengungUnit })}
                    className="rounded border border-gray-300 px-1.5 py-1.5 text-xs"
                  >
                    <option value="m3">m³</option>
                    <option value="t">t</option>
                    <option value="kg">kg</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Gabe-Nr."
                    value={row.gabe_number}
                    onChange={(e) => updateFertRow(idx, { gabe_number: e.target.value })}
                    className="w-16 rounded border border-gray-300 px-1.5 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeFertRow(idx)}
                    className="rounded px-1.5 py-1 text-red-500"
                    aria-label="Entfernen"
                  >
                    ×
                  </button>
                </div>
              ))}
              {fertRows.length === 0 && <p className="text-xs text-gray-400">Keine Düngung erfasst.</p>}
            </div>
          </section>

          <div className="flex justify-end gap-2 border-t pt-3">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
              Abbrechen
            </button>
            <button
              type="button"
              onClick={save}
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
