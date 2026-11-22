import { useMemo, useRef, useState } from 'react'
import AppIcon from '@fmis/core/AppIcon'
import { herdLocator, listAllAnimals } from '@fmis/core/animals'
import { animalRank, textRank } from '@fmis/core/search'
import { getSyncedDb as getWiesenjournalDb } from '@fmis/wiesenjournal/db/access'
import { loadFertilizerTypes } from '@fmis/wiesenjournal/lib/fertilization'
import Modal from './Modal'
import { useQuery } from '../hooks/useQuery'
import { addDaysIso, num, todayIso, USAGE_TYPE_LABEL } from '../lib/format'
import { loadMachines } from '../lib/machines'
import { ACTIVITIES, AREA_LABEL, areaFor, knownObjects, saveWorkTask, targetIcon, type Activity, type TaskTarget } from '../lib/workTasks'
import type { PGlite } from '@electric-sql/pglite'

// Nutzungen, die man planen kann (wie components/PlanCreateDialog.tsx)
const PLAN_USAGE = Object.keys(USAGE_TYPE_LABEL).filter((k) => !['weide', 'aufwuchshoehe'].includes(k))
// Schnittnutzungen (wie lib/workPlan.ts MOW): finden auch «mähen»
const MOW = new Set(['silage', 'eingrasen', 'duerrfutter_bel', 'duerrfutter_unbel', 'saeuberungsschnitt'])
const field = 'min-h-11 rounded-lg border border-gray-300 px-2 py-1.5 text-base'

async function loadChoices(pg: PGlite) {
  const today = todayIso()
  const wj = await getWiesenjournalDb().catch(() => null)
  const [machines, objects, people, animals, groups, fert, parcels] = await Promise.all([
    loadMachines(pg),
    knownObjects(pg),
    pg.query<{ id: string; name: string }>('select id, name from duty_people where deleted_at is null and active order by sort_order, name').then((r) => r.rows),
    listAllAnimals().catch(() => []),
    herdLocator()?.groups?.(today).catch(() => []) ?? Promise.resolve([]),
    wj ? loadFertilizerTypes(wj).catch(() => []) : Promise.resolve([]),
    wj
      ? wj
          .query<{ id: string; name: string; kultur_name_de: string | null; area_a: unknown }>(
            'select id, name, kultur_name_de, area_a from parcels where deleted_at is null and season_year = $1 order by name',
            [Number(today.slice(0, 4))],
          )
          .then((r) => r.rows)
          .catch(() => [])
      : Promise.resolve([]),
  ])
  return { machines, objects, people, animals, groups, fert, parcels }
}

type Hit =
  | { kind: 'activity'; key: string; activity: Activity }
  | { kind: 'parcelwork'; key: string; title: string; workKey: string }
  | { kind: 'target'; key: string; target: TaskTarget; sub?: string }
  | { kind: 'parcel'; key: string; id: string; title: string; sub?: string }
  | { kind: 'new'; key: string; title: string }
  | { kind: 'newobject'; key: string; title: string }

/** «Arbeit planen»: ein Suchfeld für Tätigkeiten, Parzellen, Tiere, Tiergruppen, Maschinen, Gebäude; auch ganz neue
 * Arbeiten. Parzellen-Arbeiten (Düngen, Mähen …) gehen an den bisherigen Dialog (Wiesenjournal), alles andere wird
 * eine Arbeit (work_tasks). «Schon erledigt» trägt gleich ein. */
export default function TaskCreateDialog({
  onClose,
  onSaved,
  onParcelWork,
  onDoneNow,
  initialDate,
}: {
  onClose: () => void
  onSaved: (date: string) => void
  /** Parzellen-Arbeit: an den Dialog fürs Wiesenjournal übergeben */
  onParcelWork: (workKey: string, parcelIds: string[], date: string) => void
  /** Arbeit gespeichert und gleich abschliessen (freie Erfassung ins Journal) */
  onDoneNow: (taskId: string) => void
  initialDate?: string
}) {
  const { data } = useQuery(loadChoices, [])
  const [q, setQ] = useState('')
  const [title, setTitle] = useState('')
  const [activity, setActivity] = useState<Activity | null>(null)
  const [parcelWork, setParcelWork] = useState<{ title: string; workKey: string } | null>(null)
  const [targets, setTargets] = useState<TaskTarget[]>([])
  const [parcels, setParcels] = useState<{ id: string; title: string }[]>([])
  const [date, setDate] = useState(initialDate ?? addDaysIso(todayIso(), 1))
  const [due, setDue] = useState('')
  const [person, setPerson] = useState('')
  const [quantity, setQuantity] = useState('')
  const [qtyOpen, setQtyOpen] = useState(false)
  const [unit, setUnit] = useState('')
  const [customer, setCustomer] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const hits = useMemo((): { group: string; items: Hit[] }[] => {
    const term = q.trim()
    if (!term || !data) return []
    const rank = <T,>(xs: { r: number | null; x: T }[]) => xs.filter((y) => y.r != null).sort((a, b) => a.r! - b.r!).map((y) => y.x)
    const acts = rank(ACTIVITIES.map((a) => ({ r: textRank(term, a.title, a.keywords, AREA_LABEL[a.area]), x: { kind: 'activity' as const, key: `a:${a.key}`, activity: a } })))
    const pw = rank([
      ...data.fert.map((t) => ({ r: textRank(term, t.name, 'düngen dünger'), x: { kind: 'parcelwork' as const, key: `pf:${t.id}`, title: `Düngen: ${t.name}`, workKey: `f:${t.id}` } })),
      ...PLAN_USAGE.map((u) => ({ r: textRank(term, USAGE_TYPE_LABEL[u], MOW.has(u) ? 'nutzung mähen schnitt' : 'nutzung'), x: { kind: 'parcelwork' as const, key: `pu:${u}`, title: USAGE_TYPE_LABEL[u], workKey: `u:${u}` } })),
    ])
    const animals = rank(
      data.animals.map((a) => ({
        r: animalRank(term, a),
        x: { kind: 'target' as const, key: `t:${a.id}`, target: { kind: 'tier' as const, module: a.moduleKey, id: a.id, label: [a.lauf_nr, a.name].filter(Boolean).join(' ') || a.label }, sub: a.label },
      })),
    )
    const groups = rank(data.groups.map((g) => ({ r: textRank(term, g.name, 'gruppe herde'), x: { kind: 'target' as const, key: `g:${g.id}`, target: { kind: 'gruppe' as const, id: g.id, label: g.name }, sub: `${g.animalIds.length} Tiere` } })))
    const machines = rank(data.machines.map((m) => ({ r: textRank(term, m.name, m.manufacturer, m.model), x: { kind: 'target' as const, key: `m:${m.id}`, target: { kind: 'maschine' as const, id: m.id, label: m.name } } })))
    const objects = rank(data.objects.map((o) => ({ r: textRank(term, o), x: { kind: 'target' as const, key: `o:${o}`, target: { kind: 'objekt' as const, label: o } } })))
    const parcelHits = rank(
      data.parcels.map((p) => ({ r: textRank(term, p.name, p.kultur_name_de), x: { kind: 'parcel' as const, key: `p:${p.id}`, id: p.id, title: p.name, sub: [num(p.area_a) != null ? `${((num(p.area_a) ?? 0) / 100).toFixed(2)} ha` : null, p.kultur_name_de].filter(Boolean).join(' · ') } })),
    )
    const out: { group: string; items: Hit[] }[] = [
      { group: 'Tätigkeiten', items: [...acts, ...pw].slice(0, 8) },
      { group: 'Tiere', items: animals.slice(0, 6) },
      { group: 'Tiergruppen', items: groups.slice(0, 5) },
      { group: 'Maschinen', items: machines.slice(0, 5) },
      { group: 'Gebäude und Objekte', items: [...objects.slice(0, 4), { kind: 'newobject', key: `no:${term}`, title: term }] },
      { group: 'Parzellen', items: parcelHits.slice(0, 6) },
      { group: 'Neue Arbeit', items: [{ kind: 'new', key: `n:${term}`, title: term }] },
    ]
    return out.filter((g) => g.items.length > 0)
  }, [q, data])

  function pick(h: Hit) {
    if (h.kind === 'activity') {
      setActivity(h.activity)
      setParcelWork(null)
      setTitle(h.activity.title)
      if (h.activity.unit && !unit) setUnit(h.activity.unit)
    } else if (h.kind === 'parcelwork') {
      setParcelWork({ title: h.title, workKey: h.workKey })
      setActivity(null)
      setTitle(h.title)
    } else if (h.kind === 'new') {
      setActivity(null)
      setParcelWork(null)
      setTitle(h.title)
    } else if (h.kind === 'newobject') {
      setTargets((t) => (t.some((x) => x.kind === 'objekt' && x.label === h.title) ? t : [...t, { kind: 'objekt', label: h.title }]))
    } else if (h.kind === 'target') {
      setTargets((t) => (t.some((x) => x.kind === h.target.kind && ('id' in x ? 'id' in h.target && x.id === h.target.id : x.label === h.target.label)) ? t : [...t, h.target]))
    } else if (h.kind === 'parcel') {
      setParcels((p) => (p.some((x) => x.id === h.id) ? p : [...p, { id: h.id, title: h.title }]))
    }
    setQ('')
    input.current?.focus()
  }

  const area = areaFor(targets, activity)
  const isParcelJob = !!parcelWork || (parcels.length > 0 && targets.length === 0)
  const showQty = area === 'brennholz' || qtyOpen || !!quantity
  const valid = title.trim().length > 0 && !isParcelJob

  async function save(doneNow: boolean) {
    if (!valid) return
    setBusy(true)
    try {
      const id = await saveWorkTask({
        title: title.trim(),
        area,
        targets,
        planned_date: date || null,
        due_date: due || null,
        person_id: person || null,
        quantity: quantity.trim() && Number.isFinite(Number(quantity.replace(',', '.'))) ? Number(quantity.replace(',', '.')) : null,
        unit: unit.trim() || null,
        customer: customer.trim() || null,
        notes: notes.trim() || null,
      })
      if (doneNow) onDoneNow(id)
      else onSaved(date)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Arbeit planen" onClose={onClose} onSubmit={() => void save(false)}>
      <div className="space-y-3">
        <div>
          <input
            ref={input}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Was und woran? Tätigkeit, Tier, Gruppe, Maschine, Gebäude, Parzelle …"
            aria-label="Tätigkeit, Tier, Gruppe, Maschine, Gebäude oder Parzelle suchen"
            className="min-h-12 w-full rounded-xl border-2 border-gray-400 px-3 text-base focus:border-brand-700 focus:outline-none"
          />
          {hits.length > 0 && (
            <div className="mt-1 max-h-80 space-y-2 overflow-y-auto rounded-xl border bg-white p-2">
              {hits.map((g) => (
                <section key={g.group}>
                  <h4 className="px-1 text-xs font-semibold text-gray-600">{g.group}</h4>
                  <ul>
                    {g.items.map((h) => (
                      <li key={h.key}>
                        <button type="button" onClick={() => pick(h)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left active:bg-gray-100">
                          <AppIcon
                            icon={
                              h.kind === 'activity'
                                ? h.activity.area === 'tiere' ? 'behandlung' : h.activity.area === 'maschine' ? 'wartung' : h.activity.area === 'brennholz' ? 'holz' : 'hof'
                                : h.kind === 'parcelwork' || h.kind === 'parcel' ? 'parzelle'
                                : h.kind === 'target' ? targetIcon[h.target.kind]
                                : h.kind === 'newobject' ? 'hof'
                                : 'erfassen'
                            }
                            size={28}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-base text-gray-900">
                              {h.kind === 'activity' ? h.activity.title : h.kind === 'target' ? h.target.label : h.kind === 'new' ? `Neue Arbeit «${h.title}»` : h.kind === 'newobject' ? `Gebäude/Objekt «${h.title}»` : h.title}
                            </span>
                            {(h.kind === 'activity' || ((h.kind === 'target' || h.kind === 'parcel') && h.sub)) && (
                              <span className="block truncate text-xs text-gray-600">{h.kind === 'activity' ? AREA_LABEL[h.activity.area] : (h as { sub?: string }).sub}</span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Gewählt: Tätigkeit und Ziele als Chips */}
        <div className="space-y-1.5">
          <label className="block text-sm">
            <span className="text-gray-600">Arbeit</span>
            <input className={`${field} w-full`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Klauen schneiden, Dach flicken" />
          </label>
          {(targets.length > 0 || parcels.length > 0) && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Ziele">
              {targets.map((t, i) => (
                <li key={`${t.kind}${'id' in t ? t.id : t.label}`} className="flex min-h-11 items-center gap-1.5 rounded-full border border-gray-300 bg-white pl-1 pr-1 text-sm">
                  <AppIcon icon={targetIcon[t.kind]} size={24} />
                  {t.label}
                  <button type="button" onClick={() => setTargets((x) => x.filter((_, j) => j !== i))} className="grid h-9 w-9 place-items-center rounded-full text-gray-600 active:bg-gray-100" aria-label={`${t.label} entfernen`}>
                    ✕
                  </button>
                </li>
              ))}
              {parcels.map((p) => (
                <li key={p.id} className="flex min-h-11 items-center gap-1.5 rounded-full border border-gray-300 bg-white pl-1 pr-1 text-sm">
                  <AppIcon icon="parzelle" size={24} />
                  {p.title}
                  <button type="button" onClick={() => setParcels((x) => x.filter((y) => y.id !== p.id))} className="grid h-9 w-9 place-items-center rounded-full text-gray-600 active:bg-gray-100" aria-label={`${p.title} entfernen`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!isParcelJob && title.trim() && <p className="text-xs text-gray-600">Bereich: {AREA_LABEL[area]} · erledigt kommt ins {area === 'tiere' ? 'Stalljournal' : 'Betriebsjournal'}{targets.some((t) => t.kind === 'maschine') ? ' und ins Maschinenjournal' : ''}.</p>}
        </div>

        {isParcelJob ? (
          <div className="space-y-2 rounded-xl bg-green-50 p-3 text-sm text-green-900">
            <p>Parzellen-Arbeiten (Düngen, Mähen …) kommen als geplante Einträge ins Wiesenjournal.</p>
            <button
              type="button"
              className="min-h-11 rounded-lg bg-green-700 px-4 font-semibold text-white"
              onClick={() => onParcelWork(parcelWork?.workKey ?? '', parcels.map((p) => p.id), date)}
            >
              Weiter: Parzellen-Arbeit planen
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label>
                <span className="text-gray-600">Geplant am</span>
                <input type="date" className={`${field} w-full`} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                <span className="text-gray-600">Bis spätestens</span>
                <input type="date" className={`${field} w-full`} value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <label className="col-span-2">
                <span className="text-gray-600">Wer</span>
                <select className={`${field} w-full`} value={person} onChange={(e) => setPerson(e.target.value)}>
                  <option value="">— offen —</option>
                  {(data?.people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {showQty ? (
                <>
                  <label>
                    <span className="text-gray-600">Menge</span>
                    <input inputMode="decimal" className={`${field} w-full`} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  </label>
                  <label>
                    <span className="text-gray-600">Einheit</span>
                    <input className={`${field} w-full`} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Ster, Std., Stk." />
                  </label>
                </>
              ) : (
                <button type="button" className="col-span-2 min-h-11 rounded-lg border border-dashed border-gray-300 text-sm text-gray-600" onClick={() => setQtyOpen(true)}>
                  + Menge angeben
                </button>
              )}
              {(area === 'brennholz' || customer) && (
                <label className="col-span-2">
                  <span className="text-gray-600">Für wen (Name, Notiz für den Lieferschein)</span>
                  <input className={`${field} w-full`} value={customer} onChange={(e) => setCustomer(e.target.value)} />
                </label>
              )}
              <label className="col-span-2">
                <span className="text-gray-600">Notiz</span>
                <textarea className={`${field} w-full`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!valid || busy} onClick={() => void save(false)} className="min-h-12 flex-1 rounded-lg bg-brand-700 px-4 font-semibold text-white disabled:opacity-40">
                Planen
              </button>
              <button type="button" disabled={!valid || busy} onClick={() => void save(true)} className="min-h-12 rounded-lg border-2 border-green-700 px-4 font-semibold text-green-800 disabled:opacity-40">
                Schon erledigt → eintragen
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
