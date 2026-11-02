import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHasPermission } from '@fmis/core/AuthContext'
import AnimalOption from '@fmis/core/AnimalOption'
import { animalProviders, listAllAnimals, listAllWatchlists, type AnimalRef } from '@fmis/core/animals'
import { shortEarTag } from '@fmis/core/earTag'
import { matchRead, useTagReader } from '@fmis/core/tagReader'
import TagReaderButton from '@fmis/core/TagReaderButton'
import { useQuery } from '../hooks/useQuery'
import Modal from '../components/Modal'
import { addDaysIso, fmtDate, todayIso } from '../lib/format'
import { activeAt, categoryLabel, compositionAt, compositionText, defaultCategory, doubleMemberships, HERD_CATEGORIES, matchNumber, numberTokens, searchMoveSources } from '../lib/herdModel'
import { changeStay, countAt, dissolveGroup, type HerdData, identifyAnimals, loadHerdData, memberAt, moveAnimals, removeMembers, resolveDoubleMemberships, saveGroup, saveLocation, setCount, setLaufhof } from '../lib/herds'
import { accessIndex, ACCESS_LABEL, monthCounter, type AccessIndex } from '../lib/outdoorAccess'
import CounterBadge from '../components/CounterBadge'
import type { HerdGroup, HerdLocation, HerdSpecies, HerdStay, LaufhofMode, LocationKind, StaySlot } from '../types'

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

const LAUFHOF_LABEL: Record<LaufhofMode, string> = { keiner: 'kein Laufhof', staendig: 'Laufhof ständig zugänglich', zeitweise: 'Laufhof zeitweise' }

/** Laufhofgänge am Tag `date` für alle Gruppen in Ställen mit zeitweisem
 * Laufhof — ein Tipp je Gruppe, oder alles wie am Vortag. */
function LaufhofToday({ data, idx, groups, date, canWrite, onChanged }: { data: HerdData; idx: AccessIndex; groups: HerdGroup[]; date: string; canWrite: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const rows = groups
    .map((g) => ({ g, day: idx.groupDay(g.id, date), prev: idx.groupDay(g.id, addDaysIso(date, -1)) }))
    .filter((r) => r.day.animals > 0 && r.day.stallLaufhof === 'zeitweise')
  if (rows.length === 0) return null
  const open = rows.filter((r) => r.day.kind == null)
  const asYesterday = rows.filter((r) => r.day.kind == null && r.prev.laufhofEntry)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Laufhof {date === todayIso() ? 'heute' : `am ${fmtDate(date)}`}</h2>
        <Link to="/tiere/auslauf" className="text-xs text-brand-700">
          Auslaufjournal →
        </Link>
      </div>
      <ul className="space-y-1">
        {rows.map(({ g, day }) => (
          <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {SPECIES_ICON[g.species]} {g.name} <span className="text-xs text-gray-500">({day.animals})</span>
            </span>
            {day.kind === 'weide' ? (
              <span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">auf der Weide</span>
            ) : (
              <button
                type="button"
                disabled={!canWrite || busy}
                onClick={() => void run(() => setLaufhof(data, g.id, date, !day.laufhofEntry))}
                className={`rounded-lg px-3 py-1 text-xs font-medium ${day.laufhofEntry ? 'bg-sky-600 text-white' : 'border border-gray-300 bg-white text-gray-600'}`}
              >
                {day.laufhofEntry ? '✓ im Laufhof' : 'im Laufhof?'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && open.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={btn} onClick={() => void run(async () => { for (const r of open) await setLaufhof(data, r.g.id, date, true) })}>
            alle {open.length} im Laufhof
          </button>
          {asYesterday.length > 0 && asYesterday.length < open.length && (
            <button type="button" disabled={busy} className={btn} onClick={() => void run(async () => { for (const r of asYesterday) await setLaufhof(data, r.g.id, date, true) })}>
              wie gestern ({asYesterday.length})
            </button>
          )}
        </div>
      )}
    </section>
  )
}

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
        {group?.active && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const n = compositionAt(group.id, data.members, data.counts, date).total
              if (!confirm(`Gruppe «${group.name}» ab ${fmtDate(date)} auflösen? ${n} Tiere stehen danach «ohne Gruppe», Stall und Weide enden.`)) return
              setBusy(true)
              void dissolveGroup(data, group, date)
                .then(onClose)
                .finally(() => setBusy(false))
            }}
            className="w-full rounded-lg border border-red-300 py-2 font-medium text-red-700 disabled:opacity-50"
          >
            Gruppe ab {fmtDate(date)} auflösen
          </button>
        )}
      </div>
    </Modal>
  )
}

/** Tiere zügeln: Einzeltiere per Nummer und/oder Anzahl ohne Nummer. */
/** Lesegerät in den Dialogen: jede Lesung hakt das Tier an (schon angehakte werden ignoriert). */
function HerdReader({ animals, selected, onAdd }: { animals: AnimalRef[]; selected: Set<string>; onAdd: (id: string) => void }) {
  const reader = useTagReader({
    moduleKey: 'tiere',
    duplicate: (read) => {
      const a = matchRead(read, animals)
      return a && selected.has(a.id) ? `${a.lauf_nr ?? shortEarTag(a.ear_tag)} schon gewählt` : null
    },
    onRead: (read) => {
      const a = matchRead(read, animals)
      if (!a) return { text: `${shortEarTag(read.earTag)}: nicht in der Auswahl`, tone: 'error' }
      onAdd(a.id)
      return `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)} gewählt (${selected.size + 1})`
    },
  })
  return <TagReaderButton reader={reader} hint="jede Lesung hakt das Tier an" />
}

/** Ein Block im Dialog «Tiere zuteilen»: eine Gruppe oder Merkliste mit ihren
 * Tieren (alle angehakt, einzeln abwählbar) oder die einzeln gesuchten Tiere. */
interface MoveBlock {
  key: string
  kind: 'group' | 'list' | 'single'
  name: string
  groupId?: string
  animalIds: string[]
  checked: Set<string>
}

const UNASSIGNED = '__ohne'

function MoveDialog({
  data,
  from,
  startUnassigned,
  date: initialDate,
  onClose,
}: {
  data: HerdData
  from: HerdGroup | null
  /** «Ohne Gruppe» schon als Block gewählt */
  startUnassigned?: boolean
  date: string
  onClose: () => void
}) {
  const [speciesSel, setSpeciesSel] = useState<HerdSpecies>(from?.species ?? 'schafe')
  const targets = data.groups.filter((g) => g.active && g.species === speciesSel && g.id !== from?.id)
  const [toId, setToId] = useState(targets[0]?.id ?? '')
  const [date, setDate] = useState(initialDate)
  const [animals, setAnimals] = useState<AnimalRef[] | null>(null)
  const [lists, setLists] = useState<{ id: string; name: string; animalIds: string[] }[]>([])
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [dissolve, setDissolve] = useState(true)
  const [dryOff, setDryOff] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const groupIds = (gid: string) => data.members.filter((m) => m.group_id === gid && activeAt(m, date)).map((m) => m.animal_id)
  // «Tiere zügeln…» an einer Gruppe: die Gruppe ist schon gewählt
  const [blocks, setBlocks] = useState<MoveBlock[]>(() => {
    if (!from) return []
    const ids = data.members.filter((m) => m.group_id === from.id && activeAt(m, initialDate)).map((m) => m.animal_id)
    return [{ key: `g:${from.id}`, kind: 'group', name: from.name, groupId: from.id, animalIds: ids, checked: new Set(ids) }]
  })

  useEffect(() => {
    void listAllAnimals(speciesSel).then(setAnimals)
    void listAllWatchlists(speciesSel).then((ls) => setLists(ls.map((l) => ({ id: l.key, name: l.name, animalIds: l.animalIds }))))
  }, [speciesSel])

  const byId = useMemo(() => new Map((animals ?? []).map((a) => [a.id, a])), [animals])
  const to = data.groups.find((g) => g.id === toId) ?? null
  // Tiere ohne Gruppe lassen sich wie eine Gruppe wählen
  const unassignedIds = (animals ?? []).filter((a) => !memberAt(data, a.id, date)).map((a) => a.id)
  const groupsForSearch = [
    ...(unassignedIds.length && !blocks.some((b) => b.groupId === UNASSIGNED) ? [{ id: UNASSIGNED, name: 'Ohne Gruppe', animalIds: unassignedIds }] : []),
    ...data.groups
      .filter((g) => g.active && g.species === speciesSel && g.id !== to?.id && !blocks.some((b) => b.groupId === g.id))
      .map((g) => ({ id: g.id, name: g.name, animalIds: groupIds(g.id) })),
  ]
  useEffect(() => {
    if (!startUnassigned || !animals || blocks.some((b) => b.groupId === UNASSIGNED)) return
    const ids = animals.filter((a) => !memberAt(data, a.id, initialDate)).map((a) => a.id)
    if (ids.length) setBlocks((prev) => [...prev, { key: `g:${UNASSIGNED}`, kind: 'group', name: 'Ohne Gruppe', groupId: UNASSIGNED, animalIds: ids, checked: new Set(ids) }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animals])
  const suggestions = animals
    ? searchMoveSources(query, { animals, groups: groupsForSearch, lists: lists.filter((l) => !blocks.some((b) => b.key === `l:${l.id}`)) })
    : []
  const groupOf = (id: string) => {
    const m = memberAt(data, id, date)
    return m ? data.groups.find((g) => g.id === m.group_id) : undefined
  }

  function addBlock(b: Omit<MoveBlock, 'checked'>) {
    const known = b.animalIds.filter((id) => byId.has(id))
    setBlocks((prev) => [...prev, { ...b, animalIds: known, checked: new Set(known) }])
    setQuery('')
  }
  function addSingle(id: string) {
    setBlocks((prev) => {
      const single = prev.find((b) => b.kind === 'single')
      if (single?.animalIds.includes(id)) return prev
      if (single) return prev.map((b) => (b === single ? { ...b, animalIds: [...b.animalIds, id], checked: new Set([...b.checked, id]) } : b))
      return [...prev, { key: 'single', kind: 'single', name: 'Einzeln gewählt', animalIds: [id], checked: new Set([id]) }]
    })
    setQuery('')
  }
  function toggle(block: MoveBlock, id: string) {
    setBlocks((prev) =>
      prev.map((b) => {
        if (b !== block) return b
        const checked = new Set(b.checked)
        if (checked.has(id)) checked.delete(id)
        else checked.add(id)
        return { ...b, checked }
      }),
    )
  }

  // Alle angehakten Tiere ziehen einzeln um (Kategorie und Trockenstellen wie gewohnt). Ist eine
  // Gruppe ganz angehakt, kann sie danach aufgelöst werden.
  const wholeGroups = blocks.filter((b) => b.kind === 'group' && b.groupId !== UNASSIGNED && b.groupId !== to?.id && b.animalIds.length > 0 && b.checked.size === b.animalIds.length)
  const chosen = [...new Set(blocks.flatMap((b) => [...b.checked]))].filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  const total = chosen.length
  const fromMilking = chosen.some((a) => groupOf(a.id)?.milking)
  const showDry = fromMilking && !to?.milking && chosen.some((a) => a.moduleKey.startsWith('dairy'))

  const reader = useTagReader({
    moduleKey: animals?.[0]?.moduleKey ?? '',
    onRead: (read) => {
      const a = matchRead(read, animals ?? [])
      if (!a) return { text: `${shortEarTag(read.earTag)}: nicht im Bestand`, tone: 'error' }
      addSingle(a.id)
      return a.label
    },
  })

  async function save() {
    if (!to) return
    setBusy(true)
    setError(null)
    try {
      await moveAnimals(data, {
        toGroup: to,
        fromGroup: null,
        date,
        animals: chosen,
        counts: {},
        groups: wholeGroups.map((b) => ({ group: data.groups.find((g) => g.id === b.groupId)!, dissolve })),
        dryOff: showDry && dryOff,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const input = 'min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base'
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
                  setBlocks([])
                  setToId(data.groups.find((g) => g.active && g.species === s)?.id ?? '')
                }}
                className={`min-h-11 flex-1 rounded-lg ${speciesSel === s ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-700'}`}
              >
                {SPECIES_ICON[s]} {SPECIES_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-700">nach</span>
            <select className={input} value={toId} onChange={(e) => setToId(e.target.value)}>
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
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <div className="relative space-y-1">
          <div className="flex gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !suggestions[0]) return
                e.preventDefault()
                const s = suggestions[0]
                if (s.kind === 'animal') addSingle(s.animal.id)
                else addBlock(s.kind === 'group' ? { key: `g:${s.id}`, kind: 'group', name: s.name, groupId: s.id, animalIds: s.animalIds } : { key: `l:${s.id}`, kind: 'list', name: s.name, animalIds: s.animalIds })
              }}
              autoComplete="off"
              placeholder="Tier, Gruppe oder Merkliste suchen"
              aria-label="Tier, Gruppe oder Merkliste suchen"
              className={`${input} min-w-0 flex-1`}
            />
            <TagReaderButton reader={reader} />
          </div>
          {(focused || query) && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 z-20 max-h-72 divide-y overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              {suggestions.map((s) => (
                <li key={s.kind === 'animal' ? `a:${s.animal.id}` : `${s.kind}:${s.id}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      s.kind === 'animal'
                        ? addSingle(s.animal.id)
                        : addBlock(s.kind === 'group' ? { key: `g:${s.id}`, kind: 'group', name: s.name, groupId: s.id, animalIds: s.animalIds } : { key: `l:${s.id}`, kind: 'list', name: s.name, animalIds: s.animalIds })
                    }
                    className="flex min-h-11 w-full items-center px-3 py-2 text-left active:bg-gray-50"
                  >
                    {s.kind === 'animal' ? (
                      <AnimalOption animal={s.animal} extra={<span className="text-gray-500">{groupOf(s.animal.id)?.name ?? 'ohne Gruppe'}</span>} />
                    ) : (
                      <span className="font-medium text-gray-900">
                        {s.kind === 'group' ? (s.id === UNASSIGNED ? '📥' : `${SPECIES_ICON[speciesSel]} Gruppe`) : '🔖 Merkliste'} «{s.name}» <span className="font-normal text-gray-500">· {s.animalIds.length} {s.animalIds.length === 1 ? 'Tier' : 'Tiere'}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query && suggestions.length === 0 && animals && <p className="text-xs text-gray-600">Nichts gefunden zu «{query}».</p>}
        </div>

        {blocks.map((b) => (
          <div key={b.key} className="rounded-lg border border-gray-200">
            <div className="flex items-center justify-between gap-2 border-b bg-gray-50 px-3 py-1.5">
              <span className="font-medium text-gray-900">
                {b.kind === 'group' ? (b.groupId === UNASSIGNED ? '📥 Ohne Gruppe' : `${SPECIES_ICON[speciesSel]} Gruppe «${b.name}»`) : b.kind === 'list' ? `🔖 Merkliste «${b.name}»` : b.name}
                <span className="font-normal text-gray-600">
                  {' '}
                  · {b.checked.size} von {b.animalIds.length}
                </span>
              </span>
              <button type="button" onClick={() => setBlocks((prev) => prev.filter((x) => x !== b))} className="grid h-11 w-11 place-items-center text-lg text-gray-600" aria-label={`${b.name} entfernen`}>
                ×
              </button>
            </div>
            <ul className="max-h-60 divide-y overflow-y-auto">
              {b.animalIds.map((id) => {
                const a = byId.get(id)!
                const g = groupOf(id)
                return (
                  <li key={id}>
                    <label className="flex min-h-11 items-center gap-2 px-3">
                      <input type="checkbox" checked={b.checked.has(id)} onChange={() => toggle(b, id)} className="h-5 w-5" />
                      <AnimalOption animal={a} extra={b.kind !== 'group' && <span className="text-gray-500">{g?.name ?? 'ohne Gruppe'}</span>} />
                    </label>
                  </li>
                )
              })}
              {b.animalIds.length === 0 && <li className="px-3 py-2 text-gray-600">keine aktiven Tiere</li>}
            </ul>
          </div>
        ))}

        {wholeGroups.length > 0 && (
          <label className="flex min-h-11 items-center gap-2 text-gray-700">
            <input type="checkbox" checked={dissolve} onChange={(e) => setDissolve(e.target.checked)} className="h-5 w-5" />
            {wholeGroups.length === 1 ? `Gruppe «${wholeGroups[0].name}»` : 'Ganz gewählte Gruppen'} danach auflösen (Stall und Weide enden)
          </label>
        )}
        {showDry && (
          <label className="flex items-start gap-2 rounded bg-amber-50 p-2 text-amber-900">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={dryOff} onChange={(e) => setDryOff(e.target.checked)} />
            <span>Tiere aus der gemolkenen Gruppe ab {fmtDate(date)} trockenstellen (Eintrag im Tierjournal, nicht mehr in der Milchwägung)</span>
          </label>
        )}
        {error && <p className="text-red-700">{error}</p>}
        <button
          type="button"
          disabled={busy || !to || total === 0}
          onClick={() => void save()}
          className="min-h-11 w-full rounded-lg bg-brand-600 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Speichert…' : `${total} ${total === 1 ? 'Tier' : 'Tiere'} nach «${to?.name ?? '…'}» zügeln`}
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
        <HerdReader animals={list} selected={selected} onAdd={(id) => setSelected((prev) => new Set(prev).add(id))} />
        <input className={field} value={numbers} onChange={(e) => applyNumbers(e.target.value)} placeholder="Laufnummern oder Ende der Ohrmarke, z.B. 2212 2213" />
        {unmatched.length > 0 && <p className="text-xs text-amber-700">Nicht gefunden: {unmatched.join(', ')}</p>}
        {ambiguous.length > 0 && <p className="text-xs text-amber-700">Mehrdeutig, bitte in der Liste wählen: {ambiguous.join(', ')}</p>}
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
          nur Tiere ohne Gruppe anzeigen
        </label>
        <div className="max-h-64 overflow-y-auto rounded border border-gray-200">
          {animals == null && <p className="p-2 text-xs text-gray-500">Lädt…</p>}
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
                <AnimalOption animal={a} extra={g && <span className="text-gray-500">({g.name})</span>} />
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
    laufhof: 'keiner',
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
            {edit.kind !== 'weide' && (
              <select className={field} value={edit.laufhof} onChange={(e) => setEdit({ ...edit, laufhof: e.target.value as LaufhofMode })}>
                <option value="keiner">kein Laufhof</option>
                <option value="staendig">Laufhof ständig zugänglich (jeder Tag zählt)</option>
                <option value="zeitweise">Laufhof zeitweise (Gänge täglich erfassen)</option>
              </select>
            )}
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
                    {l.laufhof !== 'keiner' && <span className="block text-xs text-sky-700">{LAUFHOF_LABEL[l.laufhof]}</span>}
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

/** Auslauf der Gruppe am Tag und Monatszähler (RAUS). */
function GroupAccessLine({ idx, groupId, date }: { idx: AccessIndex; groupId: string; date: string }) {
  const day = idx.groupDay(groupId, date)
  const today = todayIso()
  const counter = monthCounter(idx, groupId, date.slice(0, 7), date < today ? date : today)
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
      <span>
        Auslauf: {day.kind ? <b className="text-gray-800">{ACCESS_LABEL[day.kind]}</b> : <span className="text-gray-500">{day.stallLaufhof === 'zeitweise' ? 'noch kein Laufhof erfasst' : 'keiner'}</span>}
      </span>
      {counter && <CounterBadge c={counter} />}
    </div>
  )
}

// seq: jeder geöffnete Dialog startet frisch (eigener React-Schlüssel) —
// sonst übernähme ein neuer Dialog gleichen Typs den Zustand des vorherigen.
type DialogState = { seq: number } & (
  | { kind: 'group'; group: HerdGroup | null }
  | { kind: 'stay'; group: HerdGroup; slot: StaySlot }
  | { kind: 'count'; group: HerdGroup }
  | { kind: 'move'; from: HerdGroup | null; unassigned?: boolean }
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
  const { data, loading, refresh } = useQuery(() => loadHerdData(seasonYear), [seasonYear])
  const canWrite = useHasPermission('tiere:herden:write')
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

  // Ein Tier gehört genau einer Gruppe an — doppelt nur nach gleichzeitigem Zuteilen ohne Netz
  const doubles = useMemo(() => (data ? doubleMemberships(data.members, date) : []), [data, date])
  const groups = useMemo(() => (data?.groups ?? []).filter((g) => g.active), [data])
  const idx = useMemo(() => (data ? accessIndex(data) : null), [data])
  const close = () => {
    setDialog(null)
    setPick(new Set())
    refresh()
  }

  if (loading && !data) return <p className="p-4 text-center text-gray-500">Lädt…</p>
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

      {doubles.length > 0 && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            {doubles.length} {doubles.length === 1 ? 'Tier steht' : 'Tiere stehen'} in zwei Gruppen — ein Tier gehört nur einer Gruppe an.
          </p>
          <ul className="list-disc pl-5">
            {doubles.map((d) => (
              <li key={d.animalId}>
                {d.keep.label ?? 'Tier'}: gilt «{data.groups.find((g) => g.id === d.keep.group_id)?.name ?? '?'}» (ab {d.keep.from_date}), zu viel:{' '}
                {d.extra.map((m) => `«${data.groups.find((g) => g.id === m.group_id)?.name ?? '?'}»`).join(', ')}
              </li>
            ))}
          </ul>
          {canWrite && (
            <button
              type="button"
              onClick={() => void resolveDoubleMemberships(data, date).then(refresh)}
              className="min-h-11 rounded-lg bg-amber-700 px-3 font-semibold text-white"
            >
              Bereinigen (zuletzt zugeteilte Gruppe gilt)
            </button>
          )}
        </div>
      )}

      {idx && <LaufhofToday data={data} idx={idx} groups={groups} date={date} canWrite={canWrite} onChanged={refresh} />}

      {groups.length === 0 && (
        <p className="rounded-lg bg-white p-4 text-sm text-gray-600 shadow-sm">
          Noch keine Gruppen. Lege z.B. «Melkherde Schafe» (gemolken) und «Schafe Wyden» an, setze Stall und Weide und teile die Tiere zu — einzeln,
          aus einer Merkliste oder alle «Ohne Gruppe».
        </p>
      )}

      {groups.length > 0 && data && (gone.length || groups.some((g) => compositionAt(g.id, data.members, data.counts, date).counts.length)) ? (
        <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-amber-900">
            Bestand klären ·{' '}
            {[
              (() => {
                const n = groups.reduce((s, g) => s + compositionAt(g.id, data.members, data.counts, date).counts.reduce((t, c) => t + c.count, 0), 0)
                return n ? `${n} ohne Nummer` : null
              })(),
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
                  <button type="button" onClick={() => setDialog({ kind: 'group', group: g })} className="text-xs text-gray-500">
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
                      <span className="block text-xs text-gray-500">seit {fmtDate(stall.from_date)}</span>
                    </>
                  ) : (
                    <span className="text-gray-500">kein Stall</span>
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
                      <span className="block text-xs text-gray-500">
                        seit {fmtDate(weide.from_date)}
                        {weide.day_only ? ' · nur Tagweide' : ''}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-500">keine Weide</span>
                  )}
                </button>
              </div>
              {idx && comp.total > 0 && (
                <GroupAccessLine idx={idx} groupId={g.id} date={date} />
              )}
              <div className="flex flex-wrap gap-2">
                {canWrite && (
                  <>
                    <button type="button" onClick={() => setDialog({ kind: 'move', from: g })} className={btn}>
                      Tiere zügeln…
                    </button>
                    {/* Tiere ohne Nummer gibt es auf dem Betrieb nicht — nur für frühere Anzahlen */}
                    {comp.counts.length > 0 && (
                      <button type="button" onClick={() => setDialog({ kind: 'count', group: g })} className={btn}>
                        Anzahl ohne Nr.
                      </button>
                    )}
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
                            <Link to={`/${m.module_key}/tiere/${m.animal_id}`} className="link-btn font-medium text-brand-700">
                              {m.label ?? m.animal_id.slice(0, 8)}
                            </Link>{' '}
                            <span className="text-xs text-gray-500">{categoryLabel(m.category)} · seit {fmtDate(m.from_date)}</span>
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

      {unassigned && unassigned.length > 0 && (
        <details className="rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 p-3 text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-semibold text-amber-900">
            <span>📥 Ohne Gruppe ({unassigned.length})</span>
            <span className="text-sm font-normal">anzeigen ▾</span>
          </summary>
          <p className="text-xs text-amber-900/80">Aktive Tiere, die keiner Gruppe angehören — z.B. nach dem Auflösen einer Gruppe.</p>
          {canWrite && (
            <button type="button" onClick={() => setDialog({ kind: 'move', from: null, unassigned: true })} className="mt-2 min-h-11 rounded-lg bg-brand-600 px-3 font-medium text-white">
              Einer Gruppe zuteilen…
            </button>
          )}
          {(['schafe', 'rinder'] as HerdSpecies[]).map((sp) => {
            const list = unassigned.filter((a) => a.species === sp)
            if (!list.length) return null
            return (
              <div key={sp} className="mt-2">
                <span className="text-xs font-medium text-gray-700">
                  {SPECIES_ICON[sp]} {SPECIES_LABEL[sp]} ({list.length})
                </span>
                <ul className="mt-1 grid grid-cols-2 gap-x-2 text-sm sm:grid-cols-3">
                  {list.map((a) => (
                    <li key={`${a.moduleKey}-${a.id}`} className="truncate">
                      <Link to={`/${a.moduleKey}/tiere/${a.id}`} className="link-btn text-brand-700">
                        {a.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </details>
      )}

      {dialog?.kind === 'group' && <GroupDialog key={dialog.seq} data={data} group={dialog.group} date={date} onClose={close} />}
      {dialog?.kind === 'stay' && <StayDialog key={dialog.seq} data={data} group={dialog.group} slot={dialog.slot} date={date} onClose={close} />}
      {dialog?.kind === 'count' && <CountDialog key={dialog.seq} data={data} group={dialog.group} date={date} onClose={close} />}
      {dialog?.kind === 'move' && <MoveDialog key={dialog.seq} data={data} from={dialog.from} startUnassigned={dialog.unassigned} date={date} onClose={close} />}
      {dialog?.kind === 'locations' && <LocationsDialog key={dialog.seq} data={data} onClose={close} />}
      {dialog?.kind === 'identify' && (
        <IdentifyDialog key={dialog.seq} data={data} group={dialog.group} preselected={dialog.preselected} date={date} onClose={close} />
      )}
    </div>
  )
}
