// Aus fmis components/DayEntryEditor.tsx (59425bb). Weggelassen: Saatangaben
// (sowing_details), GPS-Track als Flächenbezug, Herden-Hinweis. Neu: Summe
// der Nährstoffe der Parzelle im laufenden Jahr.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { db, getDb } from '../db/db'
import { softDeleteRow, upsertRow } from '../db/write'
import { loadDayEntries } from '../lib/journal'
import { weideAusHerden } from '../lib/herden'
import {
  ANIMAL_CATEGORIES,
  ANIMAL_CATEGORY_LABEL,
  ANIMAL_CATEGORY_LETTER,
  USAGE_TYPE_LABEL,
  USAGE_TYPE_LETTER,
  YIELD_UNIT_LABEL,
  UNIT_LABEL,
  fmtDate,
  fmtNum,
  num,
} from '../lib/format'
import {
  deleteFertilizationEntry,
  effectiveAmount,
  loadFertilizerTypes,
  loadParcelNutrientTotals,
  saveFertilizationEntry,
} from '../lib/fertilization'
import { computeNutrients, kgPerHa, parseDilution } from '../lib/nutrients'
import Modal from './Modal'
import { ParzellenListe } from './Finder'
// Karte (Leaflet) erst laden, wenn eine Teilfläche gezeichnet wird
const ExtentPicker = lazy(() => import('./ExtentPicker'))
import type { AnimalCategory, ExtentType, FertilizationEntry, FertilizerType, Parcel, UsageEntry, UsageType, YieldUnit } from '../types'

const USAGE_TYPE_ORDER: UsageType[] = [
  'weide', 'eingrasen', 'silage', 'duerrfutter_bel', 'duerrfutter_unbel', 'weide_putzen', 'aufwuchshoehe', 'uebersaat',
  'blacken_stechen', 'blacken_einzelstock', 'blacken_flaeche', 'saeuberungsschnitt', 'pflug', 'saat', 'striegeln', 'sonstig',
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
}

const s = (v: unknown) => (v == null ? '' : String(num(v) ?? v))

function usageRowFromEntry(e: UsageEntry): UsageRow {
  return {
    id: e.id,
    usage_type: e.usage_type,
    animal_category: e.animal_category,
    day_only: !!e.day_only,
    animal_count: s(e.animal_count),
    animal_group: e.animal_group ?? '',
    label: e.label ?? '',
    value_num: s(e.value_num),
    yield_amount: s(e.yield_amount),
    yield_unit: e.yield_unit ?? '',
    notes: e.notes ?? '',
  }
}

const EMPTY_USAGE: UsageRow = {
  id: null, usage_type: 'weide', animal_category: 'kuehe', day_only: false, animal_count: '', animal_group: '',
  label: '', value_num: '', yield_amount: '', yield_unit: '', notes: '',
}

interface FertRow {
  id: string | null
  type_id: string
  amount: string
  container_count: string
  container_size: string
  dilution: string
  gabe_number: string
  notes: string
  extent_type: ExtentType
  extra_parcel_ids: string[]
  geometry: string | null
  area_a: number | null
  trip_id: string | null
  incomplete: boolean
}

const EXTENT_LABEL: Record<ExtentType, string> = {
  parcel: 'Ganze Parzelle',
  parcels: 'Mehrere Parzellen',
  polygon: 'Teilfläche auf Karte',
}

/** Feld mit sichtbarer Beschriftung darüber (Befund R6: Platzhalter allein genügen nicht). */
function Feld({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-0.5 text-xs text-gray-600 ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function numOrNull(v: string): number | null {
  const t = v.trim().replace(',', '.')
  return t === '' ? null : Number(t)
}

export default function DayEntryEditor({
  parcel,
  parcels,
  seasonYear,
  date,
  onClose,
  neueGabe,
  neueNutzung,
}: {
  parcel: Parcel
  parcels: Parcel[]
  seasonYear: number
  date: string
  onClose: () => void
  /** «Gü»/«Mi» ohne frühere Gabe: mit vorbereiteter Gabe öffnen (passende Düngerart, Fokus auf der Menge; Befund R12) */
  neueGabe?: 'guelle' | 'mist'
  /** Tätigkeit auf «Heute» (Etappe 2): mit einer neuen Nutzung dieser Art öffnen */
  neueNutzung?: UsageType
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [types, setTypes] = useState<FertilizerType[]>([])
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [pickParcelsFor, setPickParcelsFor] = useState<number | null>(null)
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [removedUsage, setRemovedUsage] = useState<string[]>([])
  const [fertRows, setFertRows] = useState<FertRow[]>([])
  const [removedFert, setRemovedFert] = useState<string[]>([])
  const [totals, setTotals] = useState<{ n_kg: number; n_avail_kg: number; p2o5_kg: number; k2o_kg: number; applications: number } | null>(null)
  const [savedFertIds, setSavedFertIds] = useState<FertilizationEntry[]>([])
  // Weide aus Herden (abgeleitet, hier nicht änderbar – über Herden oder «nicht hier» im Raster)
  const herdenWeide = useMemo(() => weideAusHerden(db(), date, date).filter((u) => u.parcel_id === parcel.id), [date, parcel.id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const pg = await getDb()
      const [{ usage, fertilizations }, ftypes, tot] = await Promise.all([
        loadDayEntries(pg, parcel.id, date),
        loadFertilizerTypes(pg),
        loadParcelNutrientTotals(pg, parcel.id, seasonYear),
      ])
      const ids = new Set(fertilizations.map((f) => f.id))
      const shareRows = pg.rows('fertilization_shares').filter((x) => ids.has(x.entry_id))
      if (cancelled) return
      const extra = new Map<string, string[]>()
      for (const r of shareRows) extra.set(r.entry_id, [...(extra.get(r.entry_id) ?? []), r.parcel_id])
      setTypes(ftypes)
      setTotals(tot)
      setSavedFertIds(fertilizations)
      setUsageRows(usage.map(usageRowFromEntry))
      setFertRows(
        fertilizations.map((f) => ({
          id: f.id,
          type_id: f.fertilizer_type_id ?? ftypes.find((t) => t.code === f.code)?.id ?? ftypes[0]?.id ?? '',
          amount: f.container_count != null ? '' : s(f.amount),
          container_count: s(f.container_count),
          container_size: s(f.container_size),
          dilution: f.dilution ?? '',
          gabe_number: s(f.gabe_number),
          notes: f.notes ?? '',
          extent_type: f.extent_type,
          extra_parcel_ids: (extra.get(f.id) ?? []).filter((id) => id !== parcel.id),
          geometry: f.geometry,
          area_a: num(f.area_a),
          trip_id: f.trip_id,
          incomplete: !!f.incomplete,
        })),
      )
      if (neueNutzung) setUsageRows((rs) => [...rs, { ...EMPTY_USAGE, usage_type: neueNutzung }])
      if (neueGabe) {
        const t = ftypes.find((x) => x.unit === (neueGabe === 'guelle' ? 'm3' : 't'))
        setFertRows((rs) => [
          ...rs,
          {
            id: null, type_id: t?.id ?? ftypes[0]?.id ?? '', amount: '', container_count: '', container_size: '', dilution: '', gabe_number: '',
            notes: '', extent_type: 'parcel', extra_parcel_ids: [], geometry: null, area_a: null, trip_id: null, incomplete: false,
          },
        ])
        setTimeout(() => {
          const felder = document.querySelectorAll<HTMLInputElement>('[data-gabe-menge]')
          felder[felder.length - 1]?.focus()
        }, 50)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [parcel.id, date, seasonYear])

  const updUsage = (i: number, patch: Partial<UsageRow>) => setUsageRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const updFert = (i: number, patch: Partial<FertRow>) => setFertRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  function amountOf(row: FertRow, type: FertilizerType | null) {
    return effectiveAmount(numOrNull(row.amount), numOrNull(row.container_count), numOrNull(row.container_size) ?? type?.container_size ?? null)
  }

  function previewFor(row: FertRow): string | null {
    const type = typeById.get(row.type_id) ?? null
    const amount = amountOf(row, type)
    if (amount == null || !type) return null
    const n = computeNutrients(amount, type, parseDilution(row.dilution))
    let area: number | null = row.area_a
    if (row.extent_type === 'parcel') area = num(parcel.area_a)
    else if (row.extent_type === 'parcels')
      area = [parcel, ...parcels.filter((p) => row.extra_parcel_ids.includes(p.id))].reduce((a, p) => a + (num(p.area_a) ?? 0), 0)
    const perHa = kgPerHa(n.n_kg, area)
    return `${fmtNum(amount, 2)} ${UNIT_LABEL[type.unit]} → ${fmtNum(n.n_kg)} kg N (${fmtNum(n.n_avail_kg)} verfügbar), P₂O₅ ${fmtNum(n.p2o5_kg)}, K₂O ${fmtNum(n.k2o_kg)} kg${
      perHa != null && area ? ` · ${fmtNum(perHa)} kg N/ha auf ${fmtNum(area, 0)} a` : ''
    }`
  }

  // Nährstoffsumme der Parzelle: gespeichert ohne die Massnahmen dieses Tages + Vorschau
  const yearSum = useMemo(() => {
    if (!totals || !types.length) return null
    let n = totals.n_kg
    let na = totals.n_avail_kg
    let p = totals.p2o5_kg
    let k = totals.k2o_kg
    const area = num(parcel.area_a)
    for (const f of savedFertIds) {
      const share = f.extent_type === 'parcel' ? 1 : null
      if (share == null) continue
      n -= num(f.n_kg) ?? 0
      na -= num(f.n_avail_kg) ?? 0
      p -= num(f.p2o5_kg) ?? 0
      k -= num(f.k2o_kg) ?? 0
    }
    let exact = true
    for (const row of fertRows) {
      const type = typeById.get(row.type_id) ?? null
      const amount = amountOf(row, type)
      if (amount == null || !type) continue
      if (row.extent_type !== 'parcel') {
        exact = false
        continue
      }
      const x = computeNutrients(amount, type, parseDilution(row.dilution))
      n += x.n_kg ?? 0
      na += x.n_avail_kg ?? 0
      p += x.p2o5_kg ?? 0
      k += x.k2o_kg ?? 0
    }
    // Teilflächen/mehrere Parzellen: gespeicherter Anteil bleibt in der Summe
    if (fertRows.some((r) => r.extent_type !== 'parcel')) exact = false
    if (!exact) {
      n = totals.n_kg
      na = totals.n_avail_kg
      p = totals.p2o5_kg
      k = totals.k2o_kg
    }
    return { n, na, p, k, perHa: kgPerHa(n, area), naPerHa: kgPerHa(na, area), exact }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals, fertRows, types, savedFertIds])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const pg = await getDb()
      // erst prüfen, dann alles in einem Zug schreiben (eine Benachrichtigung, eine IndexedDB-Transaktion)
      for (const row of fertRows) {
        if (row.extent_type === 'polygon' && !row.geometry && (row.amount || row.container_count)) throw new Error('Teilfläche: bitte auf der Karte zeichnen.')
      }
      pg.batch(() => {
      for (const id of removedUsage) softDeleteRow('usage_entries', id, { store: pg })
      for (const row of usageRows) {
        const weide = row.usage_type === 'weide'
        upsertRow(
          'usage_entries',
          {
            id: row.id ?? crypto.randomUUID(),
            parcel_id: parcel.id,
            entry_date: date,
            usage_type: row.usage_type,
            animal_category: weide ? row.animal_category : null,
            day_only: weide ? row.day_only : false,
            animal_count: weide ? numOrNull(row.animal_count) : null,
            animal_group: row.animal_group.trim() || null,
            label: row.label.trim() || null,
            value_num: numOrNull(row.value_num),
            yield_amount: numOrNull(row.yield_amount),
            yield_unit: row.yield_unit || null,
            notes: row.notes.trim() || null,
          },
          { store: pg },
        )
      }
      for (const id of removedFert) deleteFertilizationEntry(pg, id)
      for (const row of fertRows) {
        if (!row.amount && !row.container_count && !row.gabe_number && !row.notes) continue
        if (row.extent_type === 'polygon' && !row.geometry) continue
        const type = typeById.get(row.type_id) ?? null
        saveFertilizationEntry(pg, {
          id: row.id,
          anchorParcel: parcel,
          entry_date: date,
          season_year: seasonYear,
          type,
          amount: numOrNull(row.amount),
          container_count: numOrNull(row.container_count),
          container_size: numOrNull(row.container_size) ?? type?.container_size ?? null,
          dilution: row.dilution.trim() || null,
          gabe_number: numOrNull(row.gabe_number),
          notes: row.notes.trim() || null,
          extent_type: row.extent_type,
          extra_parcels: parcels.filter((p) => row.extra_parcel_ids.includes(p.id)),
          geometry: row.extent_type === 'polygon' ? row.geometry : null,
          trip_id: row.trip_id,
          incomplete: row.incomplete,
        })
      }
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`${parcel.name} · ${fmtDate(date)}`} onClose={onClose} onSubmit={() => !loading && !saving && void save()}>
      {loading ? (
        <p className="py-4 text-center text-gray-500">Lädt…</p>
      ) : (
        <div className="space-y-5 text-sm">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold text-gray-700">Nutzung</h3>
              <button type="button" className="btn min-h-10 px-3 text-xs font-medium text-brand-700" onClick={() => setUsageRows((r) => [...r, { ...EMPTY_USAGE }])}>
                + Eintrag
              </button>
            </div>
            {herdenWeide.length > 0 && (
              <div className="mb-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900" data-testid="herden-weide">
                <div className="font-medium">Weide aus Herden</div>
                {herdenWeide.map((u) => (
                  <div key={u.id}>
                    {u.animal_group} · {u.animal_count ? `${u.animal_count} ` : ''}
                    {ANIMAL_CATEGORY_LABEL[u.animal_category ?? '']}
                    {u.day_only ? ' (Tagweide)' : ''}
                  </div>
                ))}
                <div className="mt-1 text-emerald-800">Ändern auf der Tageskarte (Umziehen) oder im Raster: Zelle antippen → «nicht hier».</div>
              </div>
            )}
            <div className="space-y-3">
              {usageRows.map((row, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-2">
                  <div className="flex items-start gap-1">
                    <select className="inp flex-1" aria-label="Art der Nutzung" value={row.usage_type} onChange={(e) => updUsage(i, { usage_type: e.target.value as UsageType })}>
                      {USAGE_TYPE_ORDER.map((t) => (
                        <option key={t} value={t}>
                          {USAGE_TYPE_LABEL[t]}
                          {USAGE_TYPE_LETTER[t] ? ` (${USAGE_TYPE_LETTER[t]})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label="Entfernen"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-lg text-red-700 hover:bg-red-50"
                      onClick={() => {
                        if (row.id) setRemovedUsage((ids) => [...ids, row.id!])
                        setUsageRows((rs) => rs.filter((_, k) => k !== i))
                      }}
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
                            className={`chip ${row.animal_category === c ? 'chip-on' : 'chip-off'}`}
                            onClick={() => updUsage(i, { animal_category: c })}
                          >
                            {ANIMAL_CATEGORY_LETTER[c]} {ANIMAL_CATEGORY_LABEL[c]}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-gray-700">
                          <input type="checkbox" checked={row.day_only} onChange={(e) => updUsage(i, { day_only: e.target.checked })} />
                          nur Tagweide
                        </label>
                        <Feld label="Anzahl Tiere" className="w-28">
                          <input className="inp w-full" inputMode="numeric" placeholder="Anzahl Tiere" value={row.animal_count} onChange={(e) => updUsage(i, { animal_count: e.target.value })} />
                        </Feld>
                        <Feld label="Tiergruppe" className="min-w-0 flex-1">
                          <input className="inp w-full" placeholder="Tiergruppe" value={row.animal_group} onChange={(e) => updUsage(i, { animal_group: e.target.value })} />
                        </Feld>
                      </div>
                    </>
                  )}
                  {HARVEST_TYPES.includes(row.usage_type) && (
                    <div className="flex items-end gap-1">
                      <Feld label="Ertrag" className="w-24">
                        <input className="inp w-full" inputMode="decimal" placeholder="Ertrag" value={row.yield_amount} onChange={(e) => updUsage(i, { yield_amount: e.target.value })} />
                      </Feld>
                      <Feld label="Einheit">
                      <select className="inp" value={row.yield_unit} onChange={(e) => updUsage(i, { yield_unit: e.target.value as YieldUnit | '' })}>
                        <option value="">Einheit</option>
                        {Object.entries(YIELD_UNIT_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      </Feld>
                    </div>
                  )}
                  {SEED_TYPES.includes(row.usage_type) && (
                    <div className="flex gap-1">
                      <Feld label="Mischung / Kultur" className="min-w-0 flex-1">
                        <input className="inp w-full" placeholder="Mischung / Kultur" value={row.label} onChange={(e) => updUsage(i, { label: e.target.value })} />
                      </Feld>
                      <Feld label="Saatmenge kg/ha" className="w-28">
                        <input className="inp w-full" inputMode="decimal" placeholder="kg/ha" value={row.value_num} onChange={(e) => updUsage(i, { value_num: e.target.value })} />
                      </Feld>
                    </div>
                  )}
                  {row.usage_type === 'aufwuchshoehe' && (
                    <Feld label="Aufwuchshöhe cm (Deckelmethode)">
                      <input className="inp w-full" inputMode="decimal" placeholder="Höhe cm (Deckelmethode)" value={row.value_num} onChange={(e) => updUsage(i, { value_num: e.target.value })} />
                    </Feld>
                  )}
                  {(row.usage_type === 'sonstig' || row.usage_type.startsWith('blacken') || row.usage_type === 'weide_putzen') && (
                    <Feld label={row.usage_type === 'sonstig' ? 'Was?' : 'Mittel'}>
                      <input
                        className="inp w-full"
                        placeholder={row.usage_type === 'sonstig' ? 'Was?' : 'Mittel / Bemerkung'}
                        value={row.label}
                        onChange={(e) => updUsage(i, { label: e.target.value })}
                      />
                    </Feld>
                  )}
                  <Feld label="Bemerkung">
                    <input className="inp w-full" placeholder="Bemerkung" value={row.notes} onChange={(e) => updUsage(i, { notes: e.target.value })} />
                  </Feld>
                </div>
              ))}
              {usageRows.length === 0 && <p className="text-xs text-gray-500">Keine Nutzung erfasst.</p>}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold text-gray-700">Düngung</h3>
              <button
                type="button"
                className="btn min-h-10 px-3 text-xs font-medium text-brand-700"
                onClick={() =>
                  setFertRows((rs) => [
                    ...rs,
                    {
                      id: null, type_id: types[0]?.id ?? '', amount: '', container_count: '', container_size: '', dilution: '', gabe_number: '',
                      notes: '', extent_type: 'parcel', extra_parcel_ids: [], geometry: null, area_a: null, trip_id: null, incomplete: false,
                    },
                  ])
                }
              >
                + Gabe
              </button>
            </div>
            <div className="space-y-2">
              {fertRows.map((row, i) => {
                const type = typeById.get(row.type_id) ?? null
                const preview = previewFor(row)
                return (
                  <div key={i} className="space-y-1.5 rounded-lg border border-gray-200 p-2">
                    {row.incomplete && (
                      <p className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">⚠ Aus GPS-Fahrt mit Lücken – Anzahl Fuhren prüfen.</p>
                    )}
                    <div className="flex items-center gap-1">
                      <select className="inp min-w-0 flex-1" aria-label="Düngerart" value={row.type_id} onChange={(e) => updFert(i, { type_id: e.target.value })}>
                        {types.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.code} — {t.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label="Entfernen"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-lg text-red-700 hover:bg-red-50"
                        onClick={() => {
                          if (row.id) setRemovedFert((ids) => [...ids, row.id!])
                          setFertRows((rs) => rs.filter((_, k) => k !== i))
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex flex-wrap items-end gap-1">
                      {type?.container_label && (
                        <>
                          <Feld label={`Anzahl ${type.container_label}`} className="w-24">
                            <input
                              className="inp w-full"
                              inputMode="decimal"
                              placeholder={`Anz. ${type.container_label}`}
                              value={row.container_count}
                              onChange={(e) => updFert(i, { container_count: e.target.value })}
                            />
                          </Feld>
                          <span className="pb-2 text-xs text-gray-500">×</span>
                          <Feld label={`Inhalt ${UNIT_LABEL[type.unit]}`} className="w-24">
                            <input
                              className="inp w-full"
                              inputMode="decimal"
                              placeholder={type.container_size ? `${type.container_size}` : `${UNIT_LABEL[type.unit]}/${type.container_label}`}
                              value={row.container_size}
                              onChange={(e) => updFert(i, { container_size: e.target.value })}
                            />
                          </Feld>
                          <span className="pb-2 text-xs text-gray-500">oder</span>
                        </>
                      )}
                      <Feld label={`Menge ${type ? UNIT_LABEL[type.unit] : ''}`.trim()} className="w-24">
                        <input
                          className="inp w-full"
                          inputMode="decimal"
                          placeholder={`Menge ${type ? UNIT_LABEL[type.unit] : ''}`}
                          value={row.amount}
                          onChange={(e) => updFert(i, { amount: e.target.value })}
                          data-gabe-menge
                        />
                      </Feld>
                      {type?.unit === 'm3' && (
                        <Feld label="Verdünnung Gülle:Wasser" className="w-36">
                          <input className="inp w-full" placeholder="Verd. 1:1" value={row.dilution} onChange={(e) => updFert(i, { dilution: e.target.value })} />
                        </Feld>
                      )}
                      <Feld label="Gabe Nr." className="w-20">
                        <input className="inp w-full" inputMode="numeric" placeholder="Gabe" value={row.gabe_number} onChange={(e) => updFert(i, { gabe_number: e.target.value })} />
                      </Feld>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {(Object.keys(EXTENT_LABEL) as ExtentType[]).map((et) => (
                        <button
                          key={et}
                          type="button"
                          className={`chip ${row.extent_type === et ? 'chip-on' : 'chip-off'}`}
                          disabled={et === 'polygon' && !parcel.base_geometry && !parcels.some((p) => p.base_geometry)}
                          onClick={() => {
                            updFert(i, { extent_type: et })
                            if (et === 'polygon' && !row.geometry) setPickerFor(i)
                            if (et === 'parcels') setPickParcelsFor(i)
                          }}
                        >
                          {EXTENT_LABEL[et]}
                        </button>
                      ))}
                    </div>
                    {row.extent_type === 'parcels' && (
                      <div className="text-xs text-gray-600">
                        {parcel.name}
                        {row.extra_parcel_ids.map((id) => parcels.find((p) => p.id === id)?.name).filter(Boolean).map((n) => ` + ${n}`).join('')}{' '}
                        <button type="button" className="text-brand-700" onClick={() => setPickParcelsFor(i)}>
                          ändern
                        </button>
                      </div>
                    )}
                    {row.extent_type === 'polygon' && (
                      <div className="text-xs text-gray-600">
                        {row.geometry ? `Teilfläche gesetzt${row.area_a ? ` (${fmtNum(row.area_a)} a)` : ''}` : 'Noch keine Fläche'}{' '}
                        <button type="button" className="text-brand-700" onClick={() => setPickerFor(i)}>
                          auf Karte {row.geometry ? 'ändern' : 'zeichnen'}
                        </button>
                      </div>
                    )}
                    {preview && <p className="text-xs text-brand-800">{preview}</p>}
                    <Feld label="Bemerkung">
                      <input className="inp w-full" placeholder="Bemerkung" value={row.notes} onChange={(e) => updFert(i, { notes: e.target.value })} />
                    </Feld>
                  </div>
                )
              })}
              {fertRows.length === 0 && <p className="text-xs text-gray-500">Keine Düngung erfasst.</p>}
            </div>
            {yearSum && (
              <div className="mt-2 rounded-lg bg-brand-50 p-2 text-xs text-brand-900" data-testid="naehrstoffsumme">
                <div className="font-semibold">
                  Nährstoffe {parcel.name} {seasonYear}
                  {yearSum.exact ? ' (mit diesem Tag)' : ' (gespeicherter Stand)'}
                </div>
                <div>
                  N {fmtNum(yearSum.n)} kg ({fmtNum(yearSum.perHa)} kg/ha) · verfügbar {fmtNum(yearSum.na)} kg ({fmtNum(yearSum.naPerHa)} kg/ha) · P₂O₅{' '}
                  {fmtNum(yearSum.p)} kg · K₂O {fmtNum(yearSum.k)} kg
                </div>
              </div>
            )}
          </section>

          {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
          <div className="flex justify-end gap-2 border-t pt-3">
            <button type="button" className="btn" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Speichert…' : 'Speichern'}
            </button>
          </div>
        </div>
      )}
      {pickerFor != null && (
        <Suspense fallback={null}>
        <ExtentPicker
          parcel={parcel}
          parcels={parcels}
          initial={fertRows[pickerFor]?.geometry ?? null}
          onClose={() => setPickerFor(null)}
          onPick={(g) => {
            updFert(pickerFor, { geometry: g, extent_type: 'polygon', area_a: null })
            setPickerFor(null)
          }}
        />
        </Suspense>
      )}
      {pickParcelsFor != null && (
        <Modal title="Weitere Parzellen" onClose={() => setPickParcelsFor(null)}>
          {/* Finder mit Mehrfachauswahl (Etappe 1); gewählte bleiben sichtbar, auch wenn sie klein sind */}
          <ParzellenListe
            parcels={parcels.filter((p) => p.id !== parcel.id)}
            jahr={seasonYear}
            gewaehlt={fertRows[pickParcelsFor]?.extra_parcel_ids ?? []}
            onUmschalten={(p, an) => {
              const row = fertRows[pickParcelsFor]
              if (!row) return
              updFert(pickParcelsFor, { extra_parcel_ids: an ? [...row.extra_parcel_ids, p.id] : row.extra_parcel_ids.filter((x) => x !== p.id) })
            }}
          />
          <div className="mt-3 flex justify-end">
            <button type="button" className="btn-primary" onClick={() => setPickParcelsFor(null)}>
              Fertig
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  )
}
