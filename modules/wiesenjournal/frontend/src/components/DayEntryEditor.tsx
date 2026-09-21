import { useEffect, useMemo, useState } from 'react'
import { getDb } from '../db/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import { loadDayEntries } from '../lib/journalEntry'
import {
  ANIMAL_CATEGORIES,
  ANIMAL_CATEGORY_LABEL,
  ANIMAL_CATEGORY_LETTER,
  USAGE_TYPE_LABEL,
  USAGE_TYPE_LETTER,
  YIELD_UNIT_LABEL,
  fmtDate,
  num,
} from '../lib/format'
import { deleteFertilizationEntry, loadFertilizerTypes, saveFertilizationEntry } from '../lib/fertilization'
import { computeNutrients, kgPerHa, parseDilution } from '../lib/nutrients'
import Modal from './Modal'
import ExtentPicker from './ExtentPicker'
import type {
  AnimalCategory,
  DuengungCode,
  DuengungUnit,
  ExtentType,
  FertilizationEntry,
  FertilizerType,
  Parcel,
  Track,
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
  type_id: string
  amount: string
  container_count: string
  dilution: string
  gabe_number: string
  notes: string
  extent_type: ExtentType
  extra_parcel_ids: string[]
  geometry: string | null
  track_id: string
  track_width_m: string
  import_key: string | null
  area_a: number | null   // gespeicherte Fläche (Anzeige)
}

const EXTENT_LABEL: Record<ExtentType, string> = {
  parcel: 'Ganze Parzelle',
  parcels: 'Mehrere Parzellen',
  polygon: 'Fläche auf Karte',
  track: 'GPS-Track',
}

function fertRowFromEntry(e: FertilizationEntry, extraParcelIds: string[], types: FertilizerType[]): FertRow {
  const typeId = e.fertilizer_type_id ?? types.find((t) => t.legacy_code === e.duengung_code)?.id ?? types[0]?.id ?? ''
  return {
    id: e.id,
    type_id: typeId,
    amount: e.amount == null ? '' : String(e.amount),
    container_count: e.container_count == null ? '' : String(e.container_count),
    dilution: e.dilution ?? '',
    gabe_number: e.gabe_number == null ? '' : String(e.gabe_number),
    notes: e.notes ?? '',
    extent_type: e.extent_type ?? 'parcel',
    extra_parcel_ids: extraParcelIds,
    geometry: e.geometry,
    track_id: e.track_id ?? '',
    track_width_m: e.track_width_m == null ? '' : String(e.track_width_m),
    import_key: e.import_key,
    area_a: num(e.area_a),
  }
}

function numOrNull(s: string): number | null {
  return s.trim() === '' ? null : Number(s)
}

export default function DayEntryEditor({
  parcel,
  parcels,
  seasonYear,
  date,
  onClose,
  onSaved,
}: {
  parcel: Parcel
  parcels: Parcel[]
  seasonYear: number
  date: string
  onClose: () => void
  onSaved: () => void
}) {
  const parcelId = parcel.id
  const parcelName = parcel.name
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [types, setTypes] = useState<FertilizerType[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [pickParcelsFor, setPickParcelsFor] = useState<number | null>(null)
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])

  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [removedUsageIds, setRemovedUsageIds] = useState<string[]>([])
  const [fertRows, setFertRows] = useState<FertRow[]>([])
  const [removedFertIds, setRemovedFertIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const pg = await getDb()
      const [{ usage, fertilizations }, ftypes, { rows: trackRows }] = await Promise.all([
        loadDayEntries(pg, parcelId, date),
        loadFertilizerTypes(pg),
        // Tracks rund um den Tag (±1 Tag) als Kandidaten für den Flächenbezug
        pg.query<Track>(
          `select * from tracks where deleted_at is null and geometry is not null
           and started_at::date between ($1::date - 1) and ($1::date + 1) order by started_at`,
          [date],
        ),
      ])
      if (cancelled) return
      const shareRows = await pg.query<{ entry_id: string; parcel_id: string }>(
        'select entry_id, parcel_id from fertilization_shares where deleted_at is null and entry_id = any($1)',
        [fertilizations.map((f) => f.id)],
      )
      const extra = new Map<string, string[]>()
      for (const r of shareRows.rows) {
        extra.set(r.entry_id, [...(extra.get(r.entry_id) ?? []), r.parcel_id])
      }
      setTypes(ftypes)
      setTracks(trackRows)
      setUsageRows(usage.map(usageRowFromEntry))
      setFertRows(fertilizations.map((f) => fertRowFromEntry(f, extra.get(f.id) ?? [], ftypes)))
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

  // Menge: explizit, sonst Fass/Fuder × Inhalt der Düngerart.
  function effectiveAmount(row: FertRow, type: FertilizerType | null): number | null {
    const explicit = numOrNull(row.amount)
    if (explicit != null) return explicit
    const count = numOrNull(row.container_count)
    if (count != null && type?.container_size) return Math.round(count * type.container_size * 100) / 100
    return null
  }

  function previewFor(row: FertRow): string | null {
    const type = typeById.get(row.type_id) ?? null
    const amount = effectiveAmount(row, type)
    if (amount == null || !type) return null
    const n = computeNutrients(amount, type, parseDilution(row.dilution))
    let area: number | null = row.area_a
    if (row.extent_type === 'parcel') area = num(parcel.area_a)
    else if (row.extent_type === 'parcels') {
      area = [parcel, ...parcels.filter((p) => row.extra_parcel_ids.includes(p.id) && p.id !== parcel.id)].reduce(
        (s, p) => s + (num(p.area_a) ?? 0),
        0,
      )
    }
    const perHa = kgPerHa(n.n_kg, area)
    return `${amount} ${type.unit === 'm3' ? 'm³' : type.unit} → ${n.n_kg} kg N (${n.n_avail_kg} kg verfügbar), P₂O₅ ${n.p2o5_kg} kg, K₂O ${n.k2o_kg} kg${
      perHa != null ? ` · ${perHa} kg N/ha auf ${Math.round(area!)} a` : ''
    }`
  }

  async function save() {
    setSaving(true)
    setError(null)
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

      const pg = await getDb()
      for (const id of removedFertIds) await deleteFertilizationEntry(pg, id)
      for (const row of fertRows) {
        if (!row.amount && !row.container_count && !row.gabe_number && !row.notes) continue
        const type = typeById.get(row.type_id) ?? null
        await saveFertilizationEntry(pg, {
          id: row.id,
          anchorParcel: parcel,
          entry_date: date,
          season_year: seasonYear,
          type,
          duengung_code: (type?.legacy_code ?? 'V') as DuengungCode,
          amount: effectiveAmount(row, type),
          unit: (type?.unit ?? 'm3') as DuengungUnit,
          container_count: numOrNull(row.container_count),
          dilution: row.dilution.trim() || null,
          gabe_number: numOrNull(row.gabe_number),
          notes: row.notes.trim() || null,
          extent_type: row.extent_type,
          extra_parcels: parcels.filter((p) => row.extra_parcel_ids.includes(p.id)),
          geometry: row.extent_type === 'polygon' ? row.geometry : null,
          track_id: row.track_id || null,
          track_width_m: numOrNull(row.track_width_m),
          import_key: row.import_key,
        })
      }

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
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
                onClick={() =>
                  setFertRows((rows) => [
                    ...rows,
                    {
                      id: null, type_id: types[0]?.id ?? '', amount: '', container_count: '', dilution: '',
                      gabe_number: '', notes: '', extent_type: 'parcel', extra_parcel_ids: [], geometry: null,
                      track_id: '', track_width_m: '', import_key: null, area_a: null,
                    },
                  ])
                }
                className="text-xs font-medium text-brand-700"
              >
                + Gabe
              </button>
            </div>
            <div className="space-y-2">
              {fertRows.map((row, idx) => {
                const type = typeById.get(row.type_id) ?? null
                const preview = previewFor(row)
                return (
                  <div key={idx} className="space-y-1.5 rounded-lg border border-gray-200 p-2">
                    <div className="flex items-center gap-1">
                      <select
                        value={row.type_id}
                        onChange={(e) => updateFertRow(idx, { type_id: e.target.value })}
                        className={`${input} min-w-0 flex-1`}
                      >
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.code} — {t.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeFertRow(idx)}
                        className="rounded px-1.5 py-1 text-red-500"
                        aria-label="Entfernen"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {type?.container_label && (
                        <input
                          type="number"
                          step="0.5"
                          placeholder={type.container_label}
                          value={row.container_count}
                          onChange={(e) => updateFertRow(idx, { container_count: e.target.value })}
                          className={`${input} w-20`}
                          title={`Anzahl ${type.container_label}${type.container_size ? ` à ${type.container_size} ${type.unit === 'm3' ? 'm³' : type.unit}` : ''}`}
                        />
                      )}
                      <input
                        type="number"
                        step="0.01"
                        placeholder={`Menge ${type?.unit === 'm3' ? 'm³' : (type?.unit ?? '')}`}
                        value={row.amount}
                        onChange={(e) => updateFertRow(idx, { amount: e.target.value })}
                        className={`${input} w-24`}
                      />
                      {type?.unit === 'm3' && (
                        <input
                          type="text"
                          placeholder="Verd. 1:1"
                          value={row.dilution}
                          onChange={(e) => updateFertRow(idx, { dilution: e.target.value })}
                          className={`${input} w-20`}
                          title="Verdünnung Gülle:Wasser, z.B. 1:1 oder 3:1"
                        />
                      )}
                      <input
                        type="number"
                        placeholder="Gabe"
                        value={row.gabe_number}
                        onChange={(e) => updateFertRow(idx, { gabe_number: e.target.value })}
                        className={`${input} w-14`}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {(Object.keys(EXTENT_LABEL) as ExtentType[]).map((et) => (
                        <button
                          key={et}
                          type="button"
                          onClick={() => {
                            updateFertRow(idx, { extent_type: et })
                            if (et === 'polygon' && !row.geometry) setPickerFor(idx)
                            if (et === 'parcels') setPickParcelsFor(idx)
                          }}
                          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                            row.extent_type === et ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-gray-300 text-gray-600'
                          }`}
                        >
                          {EXTENT_LABEL[et]}
                        </button>
                      ))}
                    </div>
                    {row.extent_type === 'parcels' && (
                      <div className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
                        <span>
                          {parcel.name}
                          {row.extra_parcel_ids
                            .map((id) => parcels.find((p) => p.id === id)?.name)
                            .filter(Boolean)
                            .map((n) => ` + ${n}`)
                            .join('')}
                        </span>
                        <button type="button" onClick={() => setPickParcelsFor(idx)} className="text-brand-700">
                          ändern
                        </button>
                      </div>
                    )}
                    {row.extent_type === 'polygon' && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span>{row.geometry ? 'Fläche gesetzt' : 'Noch keine Fläche'}</span>
                        <button type="button" onClick={() => setPickerFor(idx)} className="text-brand-700">
                          auf Karte {row.geometry ? 'ändern' : 'zeichnen'}
                        </button>
                      </div>
                    )}
                    {row.extent_type === 'track' && (
                      <div className="flex flex-wrap items-center gap-1">
                        <select
                          value={row.track_id}
                          onChange={(e) => {
                            const t = tracks.find((x) => x.id === e.target.value)
                            updateFertRow(idx, {
                              track_id: e.target.value,
                              track_width_m: row.track_width_m || (t?.width_m != null ? String(t.width_m) : '12'),
                            })
                          }}
                          className={`${input} min-w-0 flex-1`}
                        >
                          <option value="">Track wählen ({tracks.length} um diesen Tag)</option>
                          {tracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label ?? 'Track'} · {new Date(t.started_at).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' })} · {t.point_count} Pkt.
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          step="0.5"
                          placeholder="Breite m"
                          value={row.track_width_m}
                          onChange={(e) => updateFertRow(idx, { track_width_m: e.target.value })}
                          className={`${input} w-20`}
                          title="Arbeitsbreite in Metern"
                        />
                      </div>
                    )}
                    {preview && <p className="text-[11px] text-brand-800">{preview}</p>}
                    <input
                      type="text"
                      placeholder="Bemerkung"
                      value={row.notes}
                      onChange={(e) => updateFertRow(idx, { notes: e.target.value })}
                      className={`${input} w-full`}
                    />
                  </div>
                )
              })}
              {fertRows.length === 0 && <p className="text-xs text-gray-400">Keine Düngung erfasst.</p>}
            </div>
          </section>

          {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
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
              {saving ? 'Speichert…' : 'Speichern'}
            </button>
          </div>
        </div>
      )}
      {pickerFor != null && (
        <ExtentPicker
          parcel={parcel}
          parcels={parcels}
          seasonYear={seasonYear}
          initial={fertRows[pickerFor]?.geometry ?? null}
          onClose={() => setPickerFor(null)}
          onPick={(g) => {
            updateFertRow(pickerFor, { geometry: g, extent_type: 'polygon' })
            setPickerFor(null)
          }}
        />
      )}
      {pickParcelsFor != null && (
        <Modal title="Weitere Parzellen" onClose={() => setPickParcelsFor(null)}>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {parcels
              .filter((p) => p.id !== parcel.id)
              .map((p) => {
                const row = fertRows[pickParcelsFor]
                const checked = row?.extra_parcel_ids.includes(p.id) ?? false
                return (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        updateFertRow(pickParcelsFor, {
                          extra_parcel_ids: e.target.checked
                            ? [...row.extra_parcel_ids, p.id]
                            : row.extra_parcel_ids.filter((id) => id !== p.id),
                        })
                      }
                    />
                    {p.farm_name ? `${p.farm_name} · ` : ''}
                    {p.name} <span className="text-xs text-gray-400">{p.area_a != null ? `${p.area_a} a` : ''}</span>
                  </label>
                )
              })}
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setPickParcelsFor(null)}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              Fertig
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
