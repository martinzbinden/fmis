import { useEffect, useState } from 'react'
import { getDb } from '../db/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import { loadDayEntries } from '../lib/journalEntry'
import {
  ANIMAL_CATEGORIES,
  ANIMAL_CATEGORY_LABEL,
  ANIMAL_CATEGORY_LETTER,
  DUENGUNG_CODES,
  USAGE_TYPE_LABEL,
  USAGE_TYPE_LETTER,
  YIELD_UNIT_LABEL,
  fmtDate,
} from '../lib/format'
import Modal from './Modal'
import type {
  AnimalCategory,
  DuengungCode,
  DuengungUnit,
  FertilizationEntry,
  UsageEntry,
  UsageType,
  YieldUnit,
} from '../types'

// Reihenfolge der Typ-Chips: erst das Alltägliche (Weide/Schnitte), dann Pflege.
const USAGE_TYPE_ORDER: UsageType[] = [
  'weide',
  'eingrasen',
  'silage',
  'duerrfutter_bel',
  'duerrfutter_unbel',
  'weide_putzen',
  'aufwuchshoehe',
  'uebersaat',
  'blacken_stechen',
  'blacken_einzelstock',
  'blacken_flaeche',
  'saeuberungsschnitt',
  'pflug',
  'saat',
  'striegeln',
  'sonstig',
]
const HARVEST_TYPES: UsageType[] = ['silage', 'duerrfutter_bel', 'duerrfutter_unbel', 'eingrasen']
const SEED_TYPES: UsageType[] = ['uebersaat', 'saat']

interface UsageRow {
  id: string | null
  usage_type: UsageType
  animal_category: AnimalCategory | null
  day_only: boolean
  animal_count: string
  animal_group: string
  label: string
  value_num: string
  yield_amount: string
  yield_unit: YieldUnit | ''
  notes: string
  paddock_version_id: string | null
  import_key: string | null
}

function usageRowFromEntry(e: UsageEntry): UsageRow {
  return {
    id: e.id,
    usage_type: e.usage_type,
    animal_category: e.animal_category,
    day_only: !!e.day_only,
    animal_count: e.animal_count == null ? '' : String(e.animal_count),
    animal_group: e.animal_group ?? '',
    label: e.label ?? '',
    value_num: e.value_num == null ? '' : String(e.value_num),
    yield_amount: e.yield_amount == null ? '' : String(e.yield_amount),
    yield_unit: e.yield_unit ?? '',
    notes: e.notes ?? '',
    paddock_version_id: e.paddock_version_id,
    import_key: e.import_key,
  }
}

const EMPTY_USAGE_ROW: UsageRow = {
  id: null,
  usage_type: 'weide',
  animal_category: 'kuehe',
  day_only: false,
  animal_count: '',
  animal_group: '',
  label: '',
  value_num: '',
  yield_amount: '',
  yield_unit: '',
  notes: '',
  paddock_version_id: null,
  import_key: null,
}

interface FertRow {
  id: string | null
  duengung_code: DuengungCode
  amount: string
  unit: DuengungUnit
  gabe_number: string
  notes: string
}

function fertRowFromEntry(e: FertilizationEntry): FertRow {
  return {
    id: e.id,
    duengung_code: e.duengung_code,
    amount: e.amount == null ? '' : String(e.amount),
    unit: e.unit,
    gabe_number: e.gabe_number == null ? '' : String(e.gabe_number),
    notes: e.notes ?? '',
  }
}

const EMPTY_FERT_ROW: FertRow = { id: null, duengung_code: 'RGv', amount: '', unit: 'm3', gabe_number: '', notes: '' }

function numOrNull(s: string): number | null {
  return s.trim() === '' ? null : Number(s)
}

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

  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [removedUsageIds, setRemovedUsageIds] = useState<string[]>([])
  const [fertRows, setFertRows] = useState<FertRow[]>([])
  const [removedFertIds, setRemovedFertIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pg = await getDb()
      const { usage, fertilizations } = await loadDayEntries(pg, parcelId, date)
      if (cancelled) return
      setUsageRows(usage.map(usageRowFromEntry))
      setFertRows(fertilizations.map(fertRowFromEntry))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [parcelId, date])

  function updateUsageRow(idx: number, patch: Partial<UsageRow>) {
    setUsageRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeUsageRow(idx: number) {
    setUsageRows((rows) => {
      const row = rows[idx]
      if (row.id) setRemovedUsageIds((ids) => [...ids, row.id!])
      return rows.filter((_, i) => i !== idx)
    })
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
      for (const id of removedUsageIds) await softDeleteRow('usage_entries', id)
      for (const row of usageRows) {
        const isWeide = row.usage_type === 'weide'
        await upsertRow('usage_entries', {
          id: row.id ?? crypto.randomUUID(),
          parcel_id: parcelId,
          entry_date: date,
          usage_type: row.usage_type,
          animal_category: isWeide ? row.animal_category : null,
          day_only: isWeide ? row.day_only : false,
          animal_count: isWeide ? numOrNull(row.animal_count) : null,
          animal_group: row.animal_group.trim() || null,
          label: row.label.trim() || null,
          value_num: numOrNull(row.value_num),
          yield_amount: numOrNull(row.yield_amount),
          yield_unit: row.yield_unit || null,
          paddock_version_id: row.paddock_version_id,
          notes: row.notes.trim() || null,
          import_key: row.import_key,
        } as never)
      }

      for (const id of removedFertIds) await softDeleteRow('fertilization_entries', id)
      for (const row of fertRows) {
        if (!row.amount && !row.gabe_number && !row.notes) continue
        await upsertRow('fertilization_entries', {
          id: row.id ?? crypto.randomUUID(),
          parcel_id: parcelId,
          entry_date: date,
          duengung_code: row.duengung_code,
          amount: numOrNull(row.amount),
          unit: row.unit,
          gabe_number: numOrNull(row.gabe_number),
          notes: row.notes.trim() || null,
        } as never)
      }

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const input = 'rounded border border-gray-300 px-2 py-1.5 text-xs'

  return (
    <Modal title={`${parcelName} · ${fmtDate(date)}`} onClose={onClose}>
      {loading ? (
        <p className="py-4 text-center text-gray-400">Lädt…</p>
      ) : (
        <div className="space-y-5">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700">Nutzung</h3>
              <button
                type="button"
                onClick={() => setUsageRows((rows) => [...rows, { ...EMPTY_USAGE_ROW }])}
                className="text-xs font-medium text-brand-700"
              >
                + Eintrag
              </button>
            </div>
            <div className="space-y-3">
              {usageRows.map((row, idx) => (
                <div key={idx} className="space-y-2 rounded-lg border border-gray-200 p-2">
                  <div className="flex items-start gap-1">
                    <select
                      value={row.usage_type}
                      onChange={(e) => updateUsageRow(idx, { usage_type: e.target.value as UsageType })}
                      className={`${input} flex-1`}
                    >
                      {USAGE_TYPE_ORDER.map((t) => (
                        <option key={t} value={t}>
                          {USAGE_TYPE_LABEL[t]}
                          {USAGE_TYPE_LETTER[t] ? ` (${USAGE_TYPE_LETTER[t]})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeUsageRow(idx)}
                      className="rounded px-1.5 py-1 text-red-500"
                      aria-label="Entfernen"
                    >
                      ×
                    </button>
                  </div>

                  {row.usage_type === 'weide' && (
                    <>
                      <div className="flex flex-wrap gap-1">
                        {ANIMAL_CATEGORIES.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => updateUsageRow(idx, { animal_category: c })}
                            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                              row.animal_category === c
                                ? 'border-brand-600 bg-brand-100 text-brand-800'
                                : 'border-gray-300 text-gray-600'
                            }`}
                            title={ANIMAL_CATEGORY_LABEL[c]}
                          >
                            {ANIMAL_CATEGORY_LETTER[c]} {ANIMAL_CATEGORY_LABEL[c]}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={row.day_only}
                            onChange={(e) => updateUsageRow(idx, { day_only: e.target.checked })}
                          />
                          nur Tagweide
                        </label>
                        <input
                          type="number"
                          placeholder="Anzahl Tiere"
                          value={row.animal_count}
                          onChange={(e) => updateUsageRow(idx, { animal_count: e.target.value })}
                          className={`${input} w-28`}
                        />
                        <input
                          type="text"
                          placeholder="Tiergruppe"
                          value={row.animal_group}
                          onChange={(e) => updateUsageRow(idx, { animal_group: e.target.value })}
                          className={`${input} flex-1`}
                        />
                      </div>
                    </>
                  )}

                  {HARVEST_TYPES.includes(row.usage_type) && (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="Ertrag"
                        value={row.yield_amount}
                        onChange={(e) => updateUsageRow(idx, { yield_amount: e.target.value })}
                        className={`${input} w-24`}
                      />
                      <select
                        value={row.yield_unit}
                        onChange={(e) => updateUsageRow(idx, { yield_unit: e.target.value as YieldUnit | '' })}
                        className={input}
                      >
                        <option value="">Einheit</option>
                        {Object.entries(YIELD_UNIT_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {SEED_TYPES.includes(row.usage_type) && (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        placeholder="Mischung / Saatgut"
                        value={row.label}
                        onChange={(e) => updateUsageRow(idx, { label: e.target.value })}
                        className={`${input} flex-1`}
                      />
                      <input
                        type="number"
                        step="0.1"
                        placeholder="kg/ha"
                        value={row.value_num}
                        onChange={(e) => updateUsageRow(idx, { value_num: e.target.value })}
                        className={`${input} w-20`}
                      />
                    </div>
                  )}

                  {row.usage_type === 'aufwuchshoehe' && (
                    <input
                      type="number"
                      step="0.5"
                      placeholder="Höhe cm (Deckelmethode)"
                      value={row.value_num}
                      onChange={(e) => updateUsageRow(idx, { value_num: e.target.value })}
                      className={`${input} w-full`}
                    />
                  )}

                  {(row.usage_type === 'sonstig' ||
                    row.usage_type.startsWith('blacken') ||
                    row.usage_type === 'weide_putzen') && (
                    <input
                      type="text"
                      placeholder={row.usage_type === 'sonstig' ? 'Was?' : 'Mittel / Bemerkung'}
                      value={row.label}
                      onChange={(e) => updateUsageRow(idx, { label: e.target.value })}
                      className={`${input} w-full`}
                    />
                  )}

                  <input
                    type="text"
                    placeholder="Bemerkung"
                    value={row.notes}
                    onChange={(e) => updateUsageRow(idx, { notes: e.target.value })}
                    className={`${input} w-full`}
                  />
                </div>
              ))}
              {usageRows.length === 0 && <p className="text-xs text-gray-400">Keine Nutzung erfasst.</p>}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700">Düngung</h3>
              <button
                type="button"
                onClick={() => setFertRows((rows) => [...rows, { ...EMPTY_FERT_ROW }])}
                className="text-xs font-medium text-brand-700"
              >
                + Gabe
              </button>
            </div>
            <div className="space-y-2">
              {fertRows.map((row, idx) => (
                <div key={idx} className="space-y-1 rounded-lg border border-gray-200 p-2">
                  <div className="flex items-center gap-1">
                    <select
                      value={row.duengung_code}
                      onChange={(e) => updateFertRow(idx, { duengung_code: e.target.value as DuengungCode })}
                      className={input}
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
                      className={`${input} w-20`}
                    />
                    <select
                      value={row.unit}
                      onChange={(e) => updateFertRow(idx, { unit: e.target.value as DuengungUnit })}
                      className={input}
                    >
                      <option value="m3">m³</option>
                      <option value="t">t</option>
                      <option value="kg">kg</option>
                    </select>
                    <input
                      type="number"
                      placeholder="Gabe"
                      value={row.gabe_number}
                      onChange={(e) => updateFertRow(idx, { gabe_number: e.target.value })}
                      className={`${input} w-14`}
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
                  <input
                    type="text"
                    placeholder="Bemerkung (z.B. nur Rand, oben)"
                    value={row.notes}
                    onChange={(e) => updateFertRow(idx, { notes: e.target.value })}
                    className={`${input} w-full`}
                  />
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
