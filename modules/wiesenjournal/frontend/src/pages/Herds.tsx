import { useEffect, useMemo, useState } from 'react'
import { useHasPermission } from '@fmis/core/AuthContext'
import { animalProviders, listAllAnimals, type AnimalRef } from '@fmis/core/animals'
import { useQuery } from '../hooks/useQuery'
import Modal from '../components/Modal'
import { fmtDate, todayIso } from '../lib/format'
import { activeAt, categoryLabel, compositionAt, compositionText, defaultCategory, HERD_CATEGORIES, matchNumber, numberTokens } from '../lib/herdModel'
import { changeStay, countAt, identifyAnimals, loadHerdData, memberAt, moveAnimals, removeMembers, saveGroup, saveLocation, setCount, type HerdData } from '../lib/herds'
import type { HerdGroup, HerdLocation, HerdSpecies, HerdStay, LocationKind, StaySlot } from '../types'

const SPECIES_ICON: Record<HerdSpecies, string> = { schafe: '🐑', rinder: '🐄' }
const SPECIES_LABEL: Record<HerdSpecies, string> = { schafe: 'Schafe', rinder: 'Rinder' }
const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'
const btn = 'rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 active:bg-gray-50'

function stayName(data: HerdData, s: HerdStay | undefined): string | null {
  if (!s) return null
  if (s.parcel_id) return data.parcels.find((p) => p.id === s.parcel_id)?.name ?? 'Parzelle?'
  return data.locations.find((l) => l.id === s.location_id)?.name ?? 'Ort?'
}

const currentStay = (data: HerdData, groupId: string, slot: StaySlot, date: string) =>
  data.stays.find((s) => s.group_id === groupId && s.slot === slot && activeAt(s, date))

/** Stall oder Weide wechseln. */
function StayDialog({
  data,
  group,
  slot,
  date: initialDate,
  onClose,
}: {
  data: HerdData
  group: HerdGroup
  slot: StaySlot
  date: string
  onClose: () => void
}) {
  const cur = currentStay(data, group.id, slot, initialDate)
  const [target, setTarget] = useState(cur ? (cur.parcel_id ? `p:${cur.parcel_id}` : `l:${cur.location_id}`) : '')
  const [dayOnly, setDayOnly] = useState(cur?.day_only ?? false)
  const [date, setDate] = useState(initialDate)
  const [busy, setBusy] = useState(false)
  const locs = data.locations.filter((l) => l.active && (slot === 'stall' ? l.kind !== 'weide' : l.kind !== 'stall'))
  const bySite = new Map<string, HerdLocation[]>()
  for (const l of locs) bySite.set(l.site ?? 'Weitere', [...(bySite.get(l.site ?? 'Weitere') ?? []), l])

  async function save() {
    setBusy(true)
    try {
      const t = target ? { location_id: target.startsWith('l:') ? target.slice(2) : null, parcel_id: target.startsWith('p:') ? target.slice(2) : null, day_only: dayOnly } : null
      await changeStay(data, group.id, slot, t, date)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`${slot === 'stall' ? 'Stall' : 'Weide'} — ${group.name}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">{slot === 'stall' ? 'Stall / Ort' : 'Weide'}</span>
          <select className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{slot === 'stall' ? '— kein Stall (nur Weide) —' : '— keine Weide (im Stall) —'}</option>
            {slot === 'weide' && (
              <optgroup label="Parzellen">
                {data.parcels.map((p) => (
                  <option key={p.id} value={`p:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            {[...bySite].map(([site, list]) => (
              <optgroup key={site} label={site}>
                {list.map((l) => (
                  <option key={l.id} value={`l:${l.id}`}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {slot === 'weide' && target && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dayOnly} onChange={(e) => setDayOnly(e.target.checked)} />
            nur Tagweide (nachts im Stall)
          </label>
        )}
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">ab</span>
          <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {cur && (
          <p className="text-xs text-gray-500">
            Bisher: {stayName(data, cur)} seit {fmtDate(cur.from_date)} — endet am Vortag.
          </p>
        )}
        <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50">
          Speichern
        </button>
      </div>
    </Modal>
  )
}

/** Tiere ohne Nummer je Kategorie. */
function CountDialog({ data, group, date: initialDate, onClose }: { data: HerdData; group: HerdGroup; date: string; onClose: () => void }) {
  const cats = HERD_CATEGORIES[group.species]
  const [date, setDate] = useState(initialDate)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(cats.map((c) => [c.key, String(countAt(data, group.id, c.key, initialDate) || '')])),
  )
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      for (const c of cats) {
        const n = Number(values[c.key] || 0)
        if (n !== countAt(data, group.id, c.key, date)) await setCount(data, group.id, c.key, n, date)
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Tiere ohne Nummer — ${group.name}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-gray-500">Für Tiere, die (noch) nicht einzeln bekannt sind. Einzeltiere mit Nummer kommen über «Tiere zügeln» in die Gruppe.</p>
        <div className="grid grid-cols-2 gap-2">
          {cats.map((c) => (
            <label key={c.key} className="block">
              <span className="mb-1 block text-gray-700">{c.label}</span>
              <input
                className={field}
                inputMode="numeric"
                value={values[c.key]}
                onChange={(e) => setValues({ ...values, [c.key]: e.target.value.replace(/\D/g, '') })}
              />
            </label>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">gilt ab</span>
          <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50">
          Speichern
        </button>
      </div>
    </Modal>
  )
}

/** Neue Gruppe oder Gruppe bearbeiten (Name, Tierart, gemolken). */
function GroupDialog({ data, group, date, onClose }: { data: HerdData; group: HerdGroup | null; date: string; onClose: () => void }) {
  const [name, setName] = useState(group?.name ?? '')
  const [species, setSpecies] = useState<HerdSpecies>(group?.species ?? 'schafe')
  const [milking, setMilking] = useState(group?.milking ?? false)
  const [active, setActive] = useState(group?.active ?? true)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await saveGroup({
        ...(group ?? { id: crypto.randomUUID(), sort_order: (data.groups.length + 1) * 10, notes: null, updated_at: '', deleted_at: null }),
        name: name.trim(),
        species,
        milking,
        active,
      } as HerdGroup)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={group ? 'Gruppe bearbeiten' : 'Neue Gruppe'} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-gray-700">Name</span>
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Melkherde Schafe, Schafe Wyden" />
        </label>
        <div className="flex gap-2">
          {(['schafe', 'rinder'] as HerdSpecies[]).map((s) => (
            <button
              key={s}
              type="button"
              disabled={!!group}
              onClick={() => setSpecies(s)}
              className={`flex-1 rounded-lg py-2 ${species === s ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'} disabled:opacity-60`}
            >
              {SPECIES_ICON[s]} {SPECIES_LABEL[s]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={milking} onChange={(e) => setMilking(e.target.checked)} />
          gemolkene Gruppe (wer sie verlässt, wird trockengestellt)
        </label>
        {group && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            aktiv
          </label>
        )}
        {!group && <p className="text-xs text-gray-500">Stall, Weide und Tiere danach in der Gruppe setzen (ab {fmtDate(date)} oder einem anderen Datum).</p>}
        <button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50">
          Speichern
        </button>
      </div>
    </Modal>
  )
}

/** Tiere zügeln: Einzeltiere per Nummer und/oder Anzahl ohne Nummer. */
function MoveDialog({
  data,
  from,
  date: initialDate,
  onClose,
}: {
  data: HerdData
  from: HerdGroup | null
  date: string
  onClose: () => void
}) {
  const species = from?.species ?? 'schafe'
  const [speciesSel, setSpeciesSel] = useState<HerdSpecies>(species)
  const targets = data.groups.filter((g) => g.active && g.species === speciesSel && g.id !== from?.id)
  const [toId, setToId] = useState(targets[0]?.id ?? '')
  const [date, setDate] = useState(initialDate)
  const [animals, setAnimals] = useState<AnimalRef[] | null>(null)
  const [numbers, setNumbers] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [onlyFrom, setOnlyFrom] = useState(!!from)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [dryOff, setDryOff] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listAllAnimals(speciesSel).then(setAnimals)
  }, [speciesSel])

  const groupOf = (a: AnimalRef) => {
    const m = memberAt(data, a.id, date)
    return m ? data.groups.find((g) => g.id === m.group_id) : undefined
  }
  const candidates = (animals ?? []).filter((a) => !onlyFrom || !from || groupOf(a)?.id === from.id)

  const tokens = numberTokens(numbers)
  function applyNumbers(text: string) {
    setNumbers(text)
    const next = new Set(selected)
    for (const t of numberTokens(text)) {
      const hit = matchNumber(animals ?? [], t)
      if (hit && hit !== 'mehrdeutig') next.add(hit.id)
    }
    setSelected(next)
  }
  const unmatched = tokens.filter((t) => matchNumber(animals ?? [], t) == null)
  const ambiguous = tokens.filter((t) => matchNumber(animals ?? [], t) === 'mehrdeutig')

  const chosen = (animals ?? []).filter((a) => selected.has(a.id))
  const to = data.groups.find((g) => g.id === toId) ?? null
  const fromMilking = chosen.some((a) => groupOf(a)?.milking) || !!from?.milking
  const showDry = fromMilking && !to?.milking && chosen.some((a) => a.moduleKey.startsWith('dairy'))
  const countNumbers = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v || 0)]))
  const countTotal = Object.values(countNumbers).reduce((s, n) => s + n, 0)

  async function save() {
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      await moveAnimals(data, {
        toGroup: to,
        fromGroup: from,
        date,
        animals: chosen,
        counts: countNumbers,
        dryOff: showDry && dryOff,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={from ? `Tiere zügeln aus «${from.name}»` : 'Tiere einer Gruppe zuteilen'} onClose={() => !busy && onClose()}>
      <div className="space-y-3 text-sm">
        {!from && (
          <div className="flex gap-2">
            {(['schafe', 'rinder'] as HerdSpecies[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSpeciesSel(s)
                  setSelected(new Set())
                  setToId(data.groups.find((g) => g.active && g.species === s)?.id ?? '')
                }}
                className={`flex-1 rounded-lg py-1.5 ${speciesSel === s ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
              >
                {SPECIES_ICON[s]} {SPECIES_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">nach</span>
            <select className={field} value={toId} onChange={(e) => setToId(e.target.value)}>
              {targets.length === 0 && <option value="">— zuerst Gruppe anlegen —</option>}
              {targets.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">am</span>
            <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <div className="space-y-1">
          <span className="block font-medium text-gray-700">Einzeltiere mit Nummer</span>
          <input
            className={field}
            value={numbers}
            onChange={(e) => applyNumbers(e.target.value)}
            placeholder="Laufnummern oder Ende der Ohrmarke, z.B. 2212 2213 1904"
          />
          {unmatched.length > 0 && <p className="text-xs text-amber-700">Nicht gefunden: {unmatched.join(', ')}</p>}
          {ambiguous.length > 0 && <p className="text-xs text-amber-700">Mehrdeutig, bitte in der Liste wählen: {ambiguous.join(', ')}</p>}
          {from && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={onlyFrom} onChange={(e) => setOnlyFrom(e.target.checked)} />
              nur Tiere aus «{from.name}» anzeigen
            </label>
          )}
          <div className="max-h-56 overflow-y-auto rounded border border-gray-200">
            {animals == null && <p className="p-2 text-xs text-gray-400">Lädt…</p>}
            {animals && candidates.length === 0 && <p className="p-2 text-xs text-gray-400">Keine Tiere.</p>}
            {candidates.map((a) => {
              const g = groupOf(a)
              return (
                <label key={`${a.moduleKey}-${a.id}`} className="flex items-center gap-2 border-b px-2 py-1 last:border-0">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={(e) => {
                      const next = new Set(selected)
                      if (e.target.checked) next.add(a.id)
                      else next.delete(a.id)
                      setSelected(next)
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{a.label}</span>
                    {a.name && <span className="text-gray-500"> {a.name}</span>}
                    {a.dry && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">trocken</span>}
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">{g ? g.name : 'ohne Gruppe'}</span>
                </label>
              )
            })}
          </div>
          {chosen.length > 0 && <p className="text-xs text-gray-600">{chosen.length} ausgewählt</p>}
        </div>

        <div className="space-y-1">
          <span className="block font-medium text-gray-700">Tiere ohne Nummer {from ? `(aus «${from.name}»)` : ''}</span>
          <div className="grid grid-cols-2 gap-2">
            {HERD_CATEGORIES[speciesSel].map((c) => {
              const max = from ? countAt(data, from.id, c.key, date) : null
              return (
                <label key={c.key} className="block text-xs text-gray-600">
                  {c.label}
                  {max != null ? ` (da: ${max})` : ''}
                  <input
                    className={field}
                    inputMode="numeric"
                    value={counts[c.key] ?? ''}
                    onChange={(e) => setCounts({ ...counts, [c.key]: e.target.value.replace(/\D/g, '') })}
                  />
                </label>
              )
            })}
          </div>
        </div>

        {showDry && (
          <label className="flex items-start gap-2 rounded bg-amber-50 p-2 text-amber-900">
            <input type="checkbox" className="mt-0.5" checked={dryOff} onChange={(e) => setDryOff(e.target.checked)} />
            <span>Einzeltiere aus der gemolkenen Gruppe ab {fmtDate(date)} trockenstellen (Eintrag im Tierjournal, nicht mehr in der Milchwägung)</span>
          </label>
        )}
        {error && <p className="text-red-600">{error}</p>}
        <button
          type="button"
          disabled={busy || !to || (chosen.length === 0 && countTotal === 0)}
          onClick={() => void save()}
          className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Speichert…' : `${chosen.length + countTotal} Tiere nach «${to?.name ?? '…'}» zügeln`}
        </button>
      </div>
    </Modal>
  )
}

/** Bestand klären: Einzeltiere per Nummer einer Gruppe zuordnen; die
 * Anzahl ohne Nummer der Gruppe sinkt entsprechend (lib/herds.ts
 * identifyAnimals). Aus «Tiere ohne Gruppe» oder aus einer Gruppe heraus. */
function IdentifyDialog({
  data,
  group: initialGroup,
  preselected,
  date: initialDate,
  onClose,
}: {
  data: HerdData
  group: HerdGroup | null
  preselected?: AnimalRef[]
  date: string
  onClose: () => void
}) {
  const active = data.groups.filter((g) => g.active)
  const [groupId, setGroupId] = useState(initialGroup?.id ?? active[0]?.id ?? '')
  const group = data.groups.find((g) => g.id === groupId) ?? null
  const species = group?.species ?? 'schafe'
  const [date, setDate] = useState(initialDate)
  const [animals, setAnimals] = useState<AnimalRef[] | null>(null)
  const [numbers, setNumbers] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set((preselected ?? []).map((a) => a.id)))
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [onlyUnassigned, setOnlyUnassigned] = useState(true)
  const [reduce, setReduce] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void listAllAnimals(species).then(setAnimals)
  }, [species])

  const list = animals ?? []
  const groupOf = (a: AnimalRef) => {
    const m = memberAt(data, a.id, date)
    return m ? data.groups.find((g) => g.id === m.group_id) : undefined
  }
  const candidates = list.filter((a) => selected.has(a.id) || !onlyUnassigned || !groupOf(a))
  const chosen = list.filter((a) => selected.has(a.id))
  const tokens = numberTokens(numbers)
  const unmatched = tokens.filter((t) => matchNumber(list, t) == null)
  const ambiguous = tokens.filter((t) => matchNumber(list, t) === 'mehrdeutig')
  const categoryOf = (a: AnimalRef) => categories[a.id] ?? defaultCategory(a, group?.milking ?? false, date)

  function applyNumbers(text: string) {
    setNumbers(text)
    const next = new Set(selected)
    for (const t of numberTokens(text)) {
      const hit = matchNumber(list, t)
      if (hit && hit !== 'mehrdeutig') next.add(hit.id)
    }
    setSelected(next)
  }

  // Vorschau: Anzahl ohne Nummer je Kategorie vorher → nachher
  const perCat = new Map<string, number>()
  for (const a of chosen) if (groupOf(a)?.id !== group?.id) perCat.set(categoryOf(a), (perCat.get(categoryOf(a)) ?? 0) + 1)
  const preview = group
    ? [...perCat].map(([cat, n]) => {
        const before = countAt(data, group.id, cat, date)
        return { cat, n, before, after: Math.max(0, before - n) }
      })
    : []
  const moving = chosen.filter((a) => groupOf(a) && groupOf(a)!.id !== group?.id)

  async function save() {
    if (!group) return
    setBusy(true)
    try {
      await identifyAnimals(data, group, chosen, Object.fromEntries(chosen.map((a) => [a.id, categoryOf(a)])), date, reduce)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Nummern erfassen" onClose={() => !busy && onClose()}>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-gray-500">
          Tiere, die schon in der Gruppe stehen, aber bisher nur gezählt waren, per Nummer erfassen. Die Anzahl ohne Nummer sinkt
          entsprechend — der Bestand bleibt gleich.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">Gruppe</span>
            <select className={field} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {active.map((g) => (
                <option key={g.id} value={g.id}>
                  {SPECIES_ICON[g.species]} {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">ab</span>
            <input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <input className={field} value={numbers} onChange={(e) => applyNumbers(e.target.value)} placeholder="Laufnummern oder Ende der Ohrmarke, z.B. 2212 2213" />
        {unmatched.length > 0 && <p className="text-xs text-amber-700">Nicht gefunden: {unmatched.join(', ')}</p>}
        {ambiguous.length > 0 && <p className="text-xs text-amber-700">Mehrdeutig, bitte in der Liste wählen: {ambiguous.join(', ')}</p>}
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
          nur Tiere ohne Gruppe anzeigen
        </label>
        <div className="max-h-64 overflow-y-auto rounded border border-gray-200">
          {animals == null && <p className="p-2 text-xs text-gray-400">Lädt…</p>}
          {candidates.map((a) => {
            const g = groupOf(a)
            const isSel = selected.has(a.id)
            return (
              <div key={`${a.moduleKey}-${a.id}`} className="flex items-center gap-2 border-b px-2 py-1 last:border-0">
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={(e) => {
                    const next = new Set(selected)
                    if (e.target.checked) next.add(a.id)
                    else next.delete(a.id)
                    setSelected(next)
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.label}</span>
                  {a.name && <span className="text-gray-500"> {a.name}</span>}
                  {g && <span className="ml-1 text-xs text-gray-400">({g.name})</span>}
                </span>
                {isSel && (
                  <select
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                    value={categoryOf(a)}
                    onChange={(e) => setCategories({ ...categories, [a.id]: e.target.value })}
                  >
                    {HERD_CATEGORIES[species].map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={reduce} onChange={(e) => setReduce(e.target.checked)} />
          <span>
            Anzahl ohne Nummer entsprechend verringern
            {reduce && preview.length > 0 && (
              <span className="block text-xs text-gray-500">
                {preview.map((p) => `${categoryLabel(p.cat)}: ${p.before} → ${p.after}${p.n > p.before ? ` (${p.n - p.before} mehr als gezählt)` : ''}`).join(' · ')}
              </span>
            )}
          </span>
        </label>
        {moving.length > 0 && (
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
            {moving.length} {moving.length === 1 ? 'Tier ist' : 'Tiere sind'} bisher in einer anderen Gruppe und wechseln ab {fmtDate(date)} hierher:{' '}
            {moving.map((a) => `${a.label} (${groupOf(a)?.name})`).join(', ')}
          </p>
        )}
        <button
          type="button"
          disabled={busy || !group || chosen.length === 0}
          onClick={() => void save()}
          className="w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Speichert…' : `${chosen.length} ${chosen.length === 1 ? 'Tier' : 'Tiere'} in «${group?.name ?? '…'}» erfassen`}
        </button>
      </div>
    </Modal>
  )
}

/** Feste Orte (Ställe, Alp) verwalten. */
function LocationsDialog({ data, onClose }: { data: HerdData; onClose: () => void }) {
  const [edit, setEdit] = useState<HerdLocation | null>(null)
  const blank = (): HerdLocation => ({
    id: crypto.randomUUID(),
    name: '',
    site: null,
    kind: 'stall',
    sort_order: (data.locations.length + 1) * 10,
    active: true,
    notes: null,
    updated_at: '',
    deleted_at: null,
  })
  return (
    <Modal title="Orte" onClose={onClose}>
      <div className="space-y-2 text-sm">
        {edit ? (
          <>
            <input className={field} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Name" />
            <input className={field} value={edit.site ?? ''} onChange={(e) => setEdit({ ...edit, site: e.target.value || null })} placeholder="Standort, z.B. Oberer Riedacker" />
            <select className={field} value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as LocationKind })}>
              <option value="stall">Stall</option>
              <option value="alp">Alp</option>
              <option value="weide">Weide (ohne Parzelle)</option>
              <option value="andere">andere</option>
            </select>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> aktiv
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEdit(null)} className={btn}>
                Abbrechen
              </button>
              <button
                type="button"
                disabled={!edit.name.trim()}
                onClick={() => void saveLocation({ ...edit, name: edit.name.trim() }).then(() => setEdit(null))}
                className="rounded bg-brand-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                Speichern
              </button>
            </div>
          </>
        ) : (
          <>
            <ul className="divide-y">
              {data.locations.map((l) => (
                <li key={l.id} className={`flex items-center justify-between py-1.5 ${l.active ? '' : 'opacity-50'}`}>
                  <span>
                    {l.name} <span className="text-xs text-gray-500">{l.site ?? ''}</span>
                  </span>
                  <button type="button" onClick={() => setEdit(l)} className={btn}>
                    Bearbeiten
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setEdit(blank())} className={btn}>
              + Ort
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}

// seq: jeder geöffnete Dialog startet frisch (eigener React-Schlüssel) —
// sonst übernähme ein neuer Dialog gleichen Typs den Zustand des vorherigen.
type DialogState = { seq: number } & (
  | { kind: 'group'; group: HerdGroup | null }
  | { kind: 'stay'; group: HerdGroup; slot: StaySlot }
  | { kind: 'count'; group: HerdGroup }
  | { kind: 'move'; from: HerdGroup | null }
  | { kind: 'identify'; group: HerdGroup | null; preselected?: AnimalRef[] }
  | { kind: 'locations' }
)
type DialogInput = DialogState extends infer D ? (D extends { seq: number } ? Omit<D, 'seq'> : never) : never

/** Herden und Standorte: welche Gruppe steht wo (Stall und Weide getrennt),
 * mit Einzeltieren und Tieren ohne Nummer. Die Weide erscheint daraus im
 * Journal-Raster. */
export default function Herds() {
  const [date, setDate] = useState(todayIso())
  const seasonYear = Number(date.slice(0, 4))
  const { data, loading, refresh } = useQuery((pg) => loadHerdData(pg, seasonYear), [seasonYear])
  const canWrite = useHasPermission('wiesenjournal:weide:write')
  const [dialog, setDialogState] = useState<DialogState | null>(null)
  const setDialog = (d: DialogInput | null) => setDialogState((prev) => (d ? ({ ...d, seq: (prev?.seq ?? 0) + 1 } as DialogState) : null))
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [allActive, setAllActive] = useState<AnimalRef[] | null>(null)
  const [pick, setPick] = useState<Set<string>>(new Set())

  useEffect(() => {
    void listAllAnimals().then(setAllActive)
  }, [data])

  // Bestand klären: Tiere ohne Gruppe, Gruppen mit Anzahl ohne Nummer,
  // Einzeltiere in Gruppen, die im Tiermodul nicht mehr aktiv sind.
  const unassigned = useMemo(() => (data && allActive ? allActive.filter((a) => !memberAt(data, a.id, date)) : null), [data, allActive, date])
  const gone = useMemo(() => {
    if (!data || !allActive) return []
    const modules = new Set(animalProviders().map(([k]) => k))
    const activeIds = new Set(allActive.map((a) => a.id))
    return data.members.filter((m) => activeAt(m, date) && modules.has(m.module_key) && !activeIds.has(m.animal_id))
  }, [data, allActive, date])

  const groups = useMemo(() => (data?.groups ?? []).filter((g) => g.active), [data])
  const close = () => {
    setDialog(null)
    setPick(new Set())
    refresh()
  }

  if (loading && !data) return <p className="p-4 text-center text-gray-400">Lädt…</p>
  if (!data) return null

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Herden & Standorte</h1>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Stand am
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-gray-300 px-2 py-1" />
        </label>
      </div>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDialog({ kind: 'group', group: null })} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
            + Gruppe
          </button>
          <button type="button" onClick={() => setDialog({ kind: 'move', from: null })} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
            Tiere zuteilen
          </button>
          <button type="button" onClick={() => setDialog({ kind: 'locations' })} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
            Orte
          </button>
        </div>
      )}

      {groups.length === 0 && (
        <p className="rounded-lg bg-white p-4 text-sm text-gray-600 shadow-sm">
          Noch keine Gruppen. Lege z.B. «Melkherde Schafe» (gemolken) und «Schafe Wyden» an, setze Stall und Weide und teile die Tiere zu — per
          Nummer oder als Anzahl ohne Nummer.
        </p>
      )}

      {groups.length > 0 && data && (unassigned?.length || gone.length || groups.some((g) => compositionAt(g.id, data.members, data.counts, date).counts.length)) ? (
        <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-amber-900">
            Bestand klären ·{' '}
            {[
              (() => {
                const n = groups.reduce((s, g) => s + compositionAt(g.id, data.members, data.counts, date).counts.reduce((t, c) => t + c.count, 0), 0)
                return n ? `${n} ohne Nummer` : null
              })(),
              unassigned?.length ? `${unassigned.length} ohne Gruppe` : null,
              gone.length ? `${gone.length} nicht mehr im Bestand` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </summary>
          <div className="mt-2 space-y-4">
            {groups.some((g) => compositionAt(g.id, data.members, data.counts, date).counts.length > 0) && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-amber-900">Tiere ohne Nummer</h3>
                <ul className="mt-1 space-y-1">
                  {groups.map((g) => {
                    const c = compositionAt(g.id, data.members, data.counts, date).counts
                    if (!c.length) return null
                    return (
                      <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white p-2">
                        <span>
                          <b>{g.name}</b>: {c.map((x) => `${x.count} ${categoryLabel(x.category)}`).join(', ')}
                        </span>
                        {canWrite && (
                          <button type="button" onClick={() => setDialog({ kind: 'identify', group: g })} className={btn}>
                            Nummern erfassen
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {unassigned && unassigned.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-amber-900">Aktive Tiere ohne Gruppe ({unassigned.length})</h3>
                <p className="text-xs text-amber-900/80">Auswählen und einer Gruppe zuteilen; steht das Tier dort schon als Anzahl ohne Nummer, wird diese verringert.</p>
                {(['schafe', 'rinder'] as HerdSpecies[]).map((sp) => {
                  const list = unassigned.filter((a) => a.species === sp)
                  if (!list.length) return null
                  return (
                    <div key={sp} className="mt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-700">
                          {SPECIES_ICON[sp]} {SPECIES_LABEL[sp]} ({list.length})
                        </span>
                        {canWrite && (
                          <span className="flex gap-1">
                            <button
                              type="button"
                              className={btn}
                              onClick={() => {
                                const next = new Set(pick)
                                const all = list.every((a) => next.has(a.id))
                                for (const a of list) {
                                  if (all) next.delete(a.id)
                                  else next.add(a.id)
                                }
                                setPick(next)
                              }}
                            >
                              alle
                            </button>
                            <button
                              type="button"
                              disabled={!list.some((a) => pick.has(a.id))}
                              className={`${btn} disabled:opacity-40`}
                              onClick={() =>
                                setDialog({
                                  kind: 'identify',
                                  group: groups.find((g) => g.species === sp) ?? null,
                                  preselected: list.filter((a) => pick.has(a.id)),
                                })
                              }
                            >
                              {list.filter((a) => pick.has(a.id)).length} zuteilen…
                            </button>
                          </span>
                        )}
                      </div>
                      <ul className="mt-1 grid grid-cols-2 gap-x-2 text-xs text-gray-700 sm:grid-cols-3">
                        {list.map((a) => (
                          <li key={`${a.moduleKey}-${a.id}`}>
                            <label className="flex items-center gap-1">
                              {canWrite && (
                                <input
                                  type="checkbox"
                                  checked={pick.has(a.id)}
                                  onChange={(e) => {
                                    const next = new Set(pick)
                                    if (e.target.checked) next.add(a.id)
                                    else next.delete(a.id)
                                    setPick(next)
                                  }}
                                />
                              )}
                              <span className="truncate">
                                {a.label} <span className="text-gray-400">{categoryLabel(defaultCategory(a, false, date))}</span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}

            {gone.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase text-amber-900">Nicht mehr im Bestand ({gone.length})</h3>
                <p className="text-xs text-amber-900/80">Im Tiermodul abgegangen, verkauft o.ä., aber noch in einer Gruppe.</p>
                <ul className="mt-1 text-xs text-gray-700">
                  {gone.map((m) => (
                    <li key={m.id}>
                      {m.label ?? m.animal_id.slice(0, 8)} — «{data.groups.find((g) => g.id === m.group_id)?.name}»
                    </li>
                  ))}
                </ul>
                {canWrite && (
                  <button
                    type="button"
                    className={`${btn} mt-1`}
                    onClick={() => {
                      if (confirm(`${gone.length} Tiere ab ${fmtDate(date)} aus ihren Gruppen nehmen?`)) void removeMembers(data, gone.map((m) => m.id), date).then(refresh)
                    }}
                  >
                    Alle ab {fmtDate(date)} aus den Gruppen nehmen
                  </button>
                )}
              </div>
            )}
          </div>
        </details>
      ) : null}

      <ul className="space-y-3">
        {groups.map((g) => {
          const comp = compositionAt(g.id, data.members, data.counts, date)
          const stall = currentStay(data, g.id, 'stall', date)
          const weide = currentStay(data, g.id, 'weide', date)
          const isOpen = open.has(g.id)
          const history = data.stays.filter((s) => s.group_id === g.id).sort((a, b) => b.from_date.localeCompare(a.from_date)).slice(0, 12)
          return (
            <li key={g.id} className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-800">
                    {SPECIES_ICON[g.species]} {g.name}
                    {g.milking && <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">gemolken</span>}
                  </div>
                  <div className="text-sm text-gray-700">
                    <b>{comp.total}</b> Tiere{comp.total ? ` · ${compositionText(comp)}` : ''}
                  </div>
                </div>
                {canWrite && (
                  <button type="button" onClick={() => setDialog({ kind: 'group', group: g })} className="text-xs text-gray-400">
                    ✎
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => setDialog({ kind: 'stay', group: g, slot: 'stall' })}
                  className="rounded border border-gray-200 p-2 text-left active:bg-gray-50"
                >
                  <span className="block text-xs text-gray-500">🏠 Stall</span>
                  {stall ? (
                    <>
                      <span className="font-medium">{stayName(data, stall)}</span>
                      <span className="block text-xs text-gray-400">seit {fmtDate(stall.from_date)}</span>
                    </>
                  ) : (
                    <span className="text-gray-400">kein Stall</span>
                  )}
                </button>
                <button
                  type="button"
                  disabled={!canWrite}
                  onClick={() => setDialog({ kind: 'stay', group: g, slot: 'weide' })}
                  className="rounded border border-gray-200 p-2 text-left active:bg-gray-50"
                >
                  <span className="block text-xs text-gray-500">🌿 Weide</span>
                  {weide ? (
                    <>
                      <span className="font-medium">{stayName(data, weide)}</span>
                      <span className="block text-xs text-gray-400">
                        seit {fmtDate(weide.from_date)}
                        {weide.day_only ? ' · nur Tagweide' : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-400">keine Weide</span>
                  )}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {canWrite && (
                  <>
                    <button type="button" onClick={() => setDialog({ kind: 'move', from: g })} className={btn}>
                      Tiere zügeln…
                    </button>
                    <button type="button" onClick={() => setDialog({ kind: 'count', group: g })} className={btn}>
                      Anzahl ohne Nr.
                    </button>
                    {comp.counts.length > 0 && (
                      <button type="button" onClick={() => setDialog({ kind: 'identify', group: g })} className={btn}>
                        Nummern erfassen ({comp.counts.reduce((s, c) => s + c.count, 0)} ohne Nr.)
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(open)
                    if (isOpen) next.delete(g.id)
                    else next.add(g.id)
                    setOpen(next)
                  }}
                  className={btn}
                >
                  {isOpen ? 'Weniger' : `Tiere & Verlauf (${comp.members.length} mit Nr.)`}
                </button>
              </div>
              {isOpen && (
                <div className="space-y-2 border-t pt-2 text-sm">
                  {comp.members.length > 0 ? (
                    <ul className="divide-y">
                      {comp.members.map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2 py-1">
                          <span>
                            {m.label ?? m.animal_id.slice(0, 8)} <span className="text-xs text-gray-500">{categoryLabel(m.category)} · seit {fmtDate(m.from_date)}</span>
                          </span>
                          {canWrite && (
                            <button
                              type="button"
                              title="Aus der Gruppe nehmen (Abgang)"
                              onClick={() => {
                                if (confirm(`${m.label ?? 'Tier'} ab ${fmtDate(date)} aus «${g.name}» nehmen?`)) void removeMembers(data, [m.id], date).then(refresh)
                              }}
                              className="text-xs text-red-700"
                            >
                              entfernen
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-gray-500">Keine Einzeltiere mit Nummer.</p>
                  )}
                  <div>
                    <span className="text-xs font-semibold text-gray-500">Verlauf</span>
                    <ul className="text-xs text-gray-600">
                      {history.map((s) => (
                        <li key={s.id}>
                          {fmtDate(s.from_date)}–{s.to_date ? fmtDate(s.to_date) : 'heute'}: {s.slot === 'stall' ? '🏠' : '🌿'} {stayName(data, s)}
                          {s.day_only ? ' (Tagweide)' : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {dialog?.kind === 'group' && <GroupDialog key={dialog.seq} data={data} group={dialog.group} date={date} onClose={close} />}
      {dialog?.kind === 'stay' && <StayDialog key={dialog.seq} data={data} group={dialog.group} slot={dialog.slot} date={date} onClose={close} />}
      {dialog?.kind === 'count' && <CountDialog key={dialog.seq} data={data} group={dialog.group} date={date} onClose={close} />}
      {dialog?.kind === 'move' && <MoveDialog key={dialog.seq} data={data} from={dialog.from} date={date} onClose={close} />}
      {dialog?.kind === 'locations' && <LocationsDialog key={dialog.seq} data={data} onClose={close} />}
      {dialog?.kind === 'identify' && (
        <IdentifyDialog key={dialog.seq} data={data} group={dialog.group} preselected={dialog.preselected} date={date} onClose={close} />
      )}
    </div>
  )
}
