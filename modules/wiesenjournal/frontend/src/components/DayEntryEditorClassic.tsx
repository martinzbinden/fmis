import { useEffect, useState } from 'react'
import { getDb } from '../db/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import { loadDayEntries, loadParcelUsageInRange } from '../lib/journalEntry'
import { findRunAt } from '../lib/journalRun'
import {
  ANIMAL_CATEGORIES,
  ANIMAL_CATEGORY_LABEL,
  USAGE_COLOR_FAMILY,
  USAGE_COLOR_LABEL,
  YIELD_UNIT_LABEL,
  addDaysIso,
  fmtDate,
  isoDateRange,
  todayIso,
  type UsageColorFamily,
} from '../lib/format'
import { deleteFertilizationEntry, loadFertilizerTypes, saveFertilizationEntry } from '../lib/fertilization'
import Modal from './Modal'
import type {
  AnimalCategory,
  DuengungCode,
  FertilizationEntry,
  FertilizerType,
  Parcel,
  UsageEntry,
  UsageType,
  YieldUnit,
} from '../types'

const WINDOW_DAYS = 180

const PFLEGE_TYPES: UsageType[] = [
  'weide_putzen',
  'blacken_stechen',
  'blacken_einzelstock',
  'blacken_flaeche',
  'uebersaat',
  'aufwuchshoehe',
  'pflug',
  'saat',
  'striegeln',
  'saeuberungsschnitt',
]
const PFLEGE_LABEL: Record<string, string> = {
  weide_putzen: 'Weide putzen',
  blacken_stechen: 'Blacken stechen',
  blacken_einzelstock: 'Blacken Einzelstock',
  blacken_flaeche: 'Blacken Fläche',
  uebersaat: 'Übersaat',
  aufwuchshoehe: 'Aufwuchshöhe',
  pflug: 'Pflug',
  saat: 'Saat',
  striegeln: 'Striegeln',
  saeuberungsschnitt: 'Säuberungsschnitt',
}
const HARVEST_FAMILIES: UsageColorFamily[] = ['silage', 'duerr']

function familyOf(usageType: UsageType): UsageColorFamily {
  return USAGE_COLOR_FAMILY[usageType] ?? 'sonstig'
}

function numOrNull(s: string): number | null {
  return s.trim() === '' ? null : Number(s)
}

interface FertState {
  id: string | null
  typeId: string
  amount: string
  containerCount: string
  gabeNumber: string
  notes: string
  importKey: string | null
}

const EMPTY_FERT: FertState = { id: null, typeId: '', amount: '', containerCount: '', gabeNumber: '', notes: '', importKey: null }

export default function DayEntryEditorClassic({
  parcel,
  seasonYear,
  date,
  onClose,
  onSaved,
}: {
  parcel: Parcel
  seasonYear: number
  date: string
  onClose: () => void
  onSaved: () => void
}) {
  const parcelId = parcel.id
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [family, setFamily] = useState<UsageColorFamily | 'keine'>('keine')
  const [pflegeType, setPflegeType] = useState<UsageType>('weide_putzen')
  const [duerrArt, setDuerrArt] = useState<'duerrfutter_bel' | 'duerrfutter_unbel'>('duerrfutter_bel')
  const [animalCategory, setAnimalCategory] = useState<AnimalCategory>('kuehe')
  const [dayOnly, setDayOnly] = useState(false)
  const [animalCount, setAnimalCount] = useState('')
  const [animalGroup, setAnimalGroup] = useState('')
  const [label, setLabel] = useState('')
  const [valueNum, setValueNum] = useState('')
  const [yieldAmount, setYieldAmount] = useState('')
  const [yieldUnit, setYieldUnit] = useState<YieldUnit | ''>('')
  const [notes, setNotes] = useState('')

  const [rangeOpen, setRangeOpen] = useState(false)
  const [endDate, setEndDate] = useState(date)
  const [initialRunDays, setInitialRunDays] = useState<string[]>([])
  const [existingByDate, setExistingByDate] = useState<Record<string, UsageEntry>>({})

  const [types, setTypes] = useState<FertilizerType[]>([])
  const [fert, setFert] = useState<FertState>(EMPTY_FERT)
  const [existingFert, setExistingFert] = useState<FertilizationEntry | null>(null)

  // "Arbeit planen" (siehe save()) nur für heute/künftige Tage anbieten —
  // vergangene Tage werden dokumentiert, nicht geplant. wasPlanned merkt sich
  // den beim Laden vorgefundenen Stand, damit der Knopf verschwindet, sobald
  // hier schon ein DEFINITIVER Eintrag liegt (sonst könnte man ihn aus
  // Versehen wieder zu einem Plan zurückstufen).
  const canPlan = date >= todayIso()
  const [wasPlanned, setWasPlanned] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let cancelled = false
    setConfirmDelete(false)
    ;(async () => {
      try {
      const pg = await getDb()
      const windowTo = addDaysIso(date, WINDOW_DAYS)
      const [{ fertilizations }, windowEntries, ftypes] = await Promise.all([
        loadDayEntries(pg, parcelId, date),
        loadParcelUsageInRange(pg, parcelId, date, windowTo),
        loadFertilizerTypes(pg),
      ])
      if (cancelled) return

      const days = isoDateRange(date, windowTo)
      const byDate: Record<string, UsageEntry[]> = {}
      for (const e of windowEntries) (byDate[e.entry_date] ??= []).push(e)
      const byDateSingle: Record<string, UsageEntry> = {}
      for (const [d, es] of Object.entries(byDate)) byDateSingle[d] = es[0]
      setExistingByDate(byDateSingle)

      const run = findRunAt(days, byDate)
      const f0 = fertilizations[0] ?? null
      setWasPlanned(!!run?.entry.is_planned || !!f0?.is_planned)
      if (run) {
        const runDays = isoDateRange(date, addDaysIso(date, run.span - 1))
        setInitialRunDays(runDays)
        setEndDate(runDays[runDays.length - 1])
        setRangeOpen(runDays.length > 1)

        const e = run.entry
        setFamily(familyOf(e.usage_type))
        if (PFLEGE_TYPES.includes(e.usage_type)) setPflegeType(e.usage_type)
        if (e.usage_type === 'duerrfutter_bel' || e.usage_type === 'duerrfutter_unbel') setDuerrArt(e.usage_type)
        setAnimalCategory(e.animal_category ?? 'kuehe')
        setDayOnly(!!e.day_only)
        setAnimalCount(e.animal_count == null ? '' : String(e.animal_count))
        setAnimalGroup(e.animal_group ?? '')
        setLabel(e.label ?? '')
        setValueNum(e.value_num == null ? '' : String(e.value_num))
        setYieldAmount(e.yield_amount == null ? '' : String(e.yield_amount))
        setYieldUnit(e.yield_unit ?? '')
        setNotes(e.notes ?? '')
      } else {
        setInitialRunDays([])
        setEndDate(date)
        setRangeOpen(false)
      }

      const f = f0
      setExistingFert(f)
      if (f) {
        const typeId = f.fertilizer_type_id ?? ftypes.find((t) => t.legacy_code === f.duengung_code)?.id ?? ftypes[0]?.id ?? ''
        setFert({
          id: f.id,
          typeId,
          amount: f.amount == null ? '' : String(f.amount),
          containerCount: f.container_count == null ? '' : String(f.container_count),
          gabeNumber: f.gabe_number == null ? '' : String(f.gabe_number),
          notes: f.notes ?? '',
          importKey: f.import_key,
        })
      } else {
        setFert({ ...EMPTY_FERT, typeId: ftypes[0]?.id ?? '' })
      }
      setTypes(ftypes)
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Laden fehlgeschlagen')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [parcelId, date])

  function resolveUsageType(): UsageType | null {
    switch (family) {
      case 'keine':
        return null
      case 'weide':
        return 'weide'
      case 'eingrasen':
        return 'eingrasen'
      case 'silage':
        return 'silage'
      case 'duerr':
        return duerrArt
      case 'pflege':
        return pflegeType
      case 'sonstig':
        return 'sonstig'
    }
  }

  function typeById(id: string): FertilizerType | null {
    return types.find((t) => t.id === id) ?? null
  }
  function effectiveFertAmount(): number | null {
    const explicit = numOrNull(fert.amount)
    if (explicit != null) return explicit
    const count = numOrNull(fert.containerCount)
    const t = typeById(fert.typeId)
    if (count != null && t?.container_size) return Math.round(count * t.container_size * 100) / 100
    return null
  }

  async function save(planned: boolean) {
    setSaving(true)
    try {
      const usageType = resolveUsageType()
      const newDays = usageType ? isoDateRange(date, rangeOpen ? endDate : date) : []
      const toDelete = initialRunDays.filter((d) => !newDays.includes(d))
      for (const d of toDelete) {
        const existing = existingByDate[d]
        if (existing) await softDeleteRow('usage_entries', existing.id)
      }
      for (const d of newDays) {
        const existing = existingByDate[d]
        await upsertRow('usage_entries', {
          id: existing?.id ?? crypto.randomUUID(),
          parcel_id: parcelId,
          entry_date: d,
          usage_type: usageType!,
          animal_category: usageType === 'weide' ? animalCategory : null,
          day_only: usageType === 'weide' ? dayOnly : false,
          animal_count: usageType === 'weide' && animalCount ? Number(animalCount) : null,
          animal_group: animalGroup.trim() || null,
          label: label.trim() || null,
          value_num: numOrNull(valueNum),
          yield_amount: numOrNull(yieldAmount),
          yield_unit: yieldUnit || null,
          paddock_version_id: existing?.paddock_version_id ?? null,
          notes: notes.trim() || null,
          import_key: existing?.import_key ?? null,
          is_planned: planned,
        } as never)
      }

      const pg = await getDb()
      const fertEmpty = !fert.amount && !fert.containerCount && !fert.gabeNumber && !fert.notes
      if (fertEmpty) {
        if (existingFert) await deleteFertilizationEntry(pg, existingFert.id)
      } else {
        const type = typeById(fert.typeId)
        await saveFertilizationEntry(pg, {
          id: fert.id,
          anchorParcel: parcel,
          entry_date: date,
          season_year: seasonYear,
          type,
          duengung_code: (type?.legacy_code ?? 'V') as DuengungCode,
          amount: effectiveFertAmount(),
          unit: type?.unit ?? 'm3',
          container_count: numOrNull(fert.containerCount),
          dilution: null,
          gabe_number: numOrNull(fert.gabeNumber),
          notes: fert.notes.trim() || null,
          extent_type: 'parcel',
          extra_parcels: [],
          geometry: null,
          track_id: null,
          track_width_m: null,
          import_key: fert.importKey,
          is_planned: planned,
        })
      }

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  // "Löschen" mit Sicherheitsabfrage: erster Klick bewaffnet (Knopf wird zur
  // Rückfrage), zweiter Klick oder Ctrl/Cmd+Enter (siehe Tastatur-Handler im
  // Modal) löscht sofort — verhindert ein versehentliches Löschen, ohne für
  // Vielnutzer einen eigenen Dialog zu brauchen.
  async function handleDelete() {
    setSaving(true)
    try {
      for (const d of initialRunDays) {
        const existing = existingByDate[d]
        if (existing) await softDeleteRow('usage_entries', existing.id)
      }
      if (existingFert) {
        const pg = await getDb()
        await deleteFertilizationEntry(pg, existingFert.id)
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const input = 'rounded border border-gray-300 px-2 py-1.5 text-xs'
  const FAMILY_OPTIONS: (UsageColorFamily | 'keine')[] = ['keine', 'weide', 'eingrasen', 'silage', 'duerr', 'pflege', 'sonstig']
  const hasExisting = initialRunDays.length > 0 || existingFert !== null
  const showPlanButton = canPlan && !(hasExisting && !wasPlanned)

  return (
    <Modal title={`${parcel.name} · ${fmtDate(date)}`} onClose={onClose}>
      {loading ? (
        <p className="py-4 text-center text-gray-400">Lädt…</p>
      ) : loadError ? (
        <p className="rounded bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
      ) : (
        <div
          className="space-y-4"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && hasExisting && !saving) {
              e.preventDefault()
              void handleDelete()
            }
          }}
        >
          <section>
            <h3 className="mb-2 text-sm font-bold text-gray-700">Nutzung</h3>
            <div className="flex flex-wrap gap-1.5">
              {FAMILY_OPTIONS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFamily(f)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    family === f ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-gray-300 text-gray-600'
                  }`}
                >
                  {f === 'keine' ? 'Keine' : USAGE_COLOR_LABEL[f]}
                </button>
              ))}
            </div>

            {family === 'weide' && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1">
                  {ANIMAL_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAnimalCategory(c)}
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                        animalCategory === c ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-gray-300 text-gray-600'
                      }`}
                    >
                      {ANIMAL_CATEGORY_LABEL[c]}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-700">
                    <input type="checkbox" checked={dayOnly} onChange={(e) => setDayOnly(e.target.checked)} />
                    nur Tagweide
                  </label>
                  <input
                    type="number"
                    placeholder="Anzahl Tiere"
                    value={animalCount}
                    onChange={(e) => setAnimalCount(e.target.value)}
                    className={`${input} w-28`}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Tiergruppe (optional)"
                  value={animalGroup}
                  onChange={(e) => setAnimalGroup(e.target.value)}
                  className={`${input} w-full`}
                />
              </div>
            )}

            {family === 'duerr' && (
              <div className="mt-2 flex gap-1.5">
                {(['duerrfutter_bel', 'duerrfutter_unbel'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDuerrArt(t)}
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      duerrArt === t ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-gray-300 text-gray-600'
                    }`}
                  >
                    {t === 'duerrfutter_bel' ? 'belüftet' : 'unbelüftet'}
                  </button>
                ))}
              </div>
            )}

            {family === 'pflege' && (
              <select
                value={pflegeType}
                onChange={(e) => setPflegeType(e.target.value as UsageType)}
                className={`${input} mt-2 w-full`}
              >
                {PFLEGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PFLEGE_LABEL[t]}
                  </option>
                ))}
              </select>
            )}

            {HARVEST_FAMILIES.includes(family as UsageColorFamily) && (
              <div className="mt-2 flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  placeholder="Ertrag"
                  value={yieldAmount}
                  onChange={(e) => setYieldAmount(e.target.value)}
                  className={`${input} w-24`}
                />
                <select value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value as YieldUnit | '')} className={input}>
                  <option value="">Einheit</option>
                  {Object.entries(YIELD_UNIT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {family === 'pflege' && pflegeType === 'aufwuchshoehe' && (
              <input
                type="number"
                step="0.5"
                placeholder="Höhe cm"
                value={valueNum}
                onChange={(e) => setValueNum(e.target.value)}
                className={`${input} mt-2 w-full`}
              />
            )}
            {family === 'pflege' && pflegeType === 'uebersaat' && (
              <input
                type="text"
                placeholder="Mischung / Saatgut"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className={`${input} mt-2 w-full`}
              />
            )}
            {family === 'sonstig' && (
              <input
                type="text"
                placeholder="Was?"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className={`${input} mt-2 w-full`}
              />
            )}

            {family !== 'keine' && (
              <input
                type="text"
                placeholder="Bemerkung"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${input} mt-2 w-full`}
              />
            )}

            {family !== 'keine' && (
              <div className="mt-3 border-t pt-2 text-xs">
                {!rangeOpen ? (
                  <div className="flex items-center gap-2 text-gray-600">
                    <span>Am {fmtDate(date)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRangeOpen(true)
                        setEndDate(date)
                      }}
                      className="font-medium text-brand-700"
                    >
                      + Mehrere Tage
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-gray-600">
                    <span>Von {fmtDate(date)} bis</span>
                    <input
                      type="date"
                      value={endDate}
                      min={date}
                      onChange={(e) => setEndDate(e.target.value || date)}
                      className={input}
                    />
                    <button type="button" onClick={() => setRangeOpen(false)} className="text-gray-400">
                      zurück auf 1 Tag
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="border-t pt-3">
            <h3 className="mb-2 text-sm font-bold text-gray-700">Düngung ({fmtDate(date)})</h3>
            <div className="flex flex-wrap items-center gap-1">
              <select
                value={fert.typeId}
                onChange={(e) => setFert((f) => ({ ...f, typeId: e.target.value }))}
                className={`${input} min-w-0 flex-1`}
              >
                <option value="">Keine</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </select>
            </div>
            {fert.typeId && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {typeById(fert.typeId)?.container_label && (
                  <input
                    type="number"
                    step="0.5"
                    placeholder={typeById(fert.typeId)!.container_label!}
                    value={fert.containerCount}
                    onChange={(e) => setFert((f) => ({ ...f, containerCount: e.target.value }))}
                    className={`${input} w-20`}
                  />
                )}
                <input
                  type="number"
                  step="0.01"
                  placeholder={`Menge ${typeById(fert.typeId)?.unit === 'm3' ? 'm³' : (typeById(fert.typeId)?.unit ?? '')}`}
                  value={fert.amount}
                  onChange={(e) => setFert((f) => ({ ...f, amount: e.target.value }))}
                  className={`${input} w-24`}
                />
                <input
                  type="number"
                  placeholder="Gabe"
                  value={fert.gabeNumber}
                  onChange={(e) => setFert((f) => ({ ...f, gabeNumber: e.target.value }))}
                  className={`${input} w-16`}
                />
              </div>
            )}
            <input
              type="text"
              placeholder="Bemerkung"
              value={fert.notes}
              onChange={(e) => setFert((f) => ({ ...f, notes: e.target.value }))}
              className={`${input} mt-1.5 w-full`}
            />
          </section>

          <div className="flex items-center justify-between gap-2 border-t pt-3">
            {hasExisting ? (
              <button
                type="button"
                onClick={() => (confirmDelete ? void handleDelete() : setConfirmDelete(true))}
                onBlur={() => setConfirmDelete(false)}
                disabled={saving}
                title="Nochmals klicken oder Ctrl+Enter zum Bestätigen"
                className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                  confirmDelete ? 'bg-red-600 text-white' : 'text-red-600'
                }`}
              >
                {confirmDelete ? 'Wirklich löschen?' : 'Löschen'}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-600">
                Abbrechen
              </button>
              {showPlanButton && (
                <button
                  type="button"
                  onClick={() => save(true)}
                  disabled={saving}
                  title="Als Plan speichern — auffällig umrahmt, noch kein definitiver Eintrag"
                  className="rounded-lg border-2 border-dashed border-gray-500 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
                >
                  Arbeit planen
                </button>
              )}
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Speichert…' : 'Eintrag speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
