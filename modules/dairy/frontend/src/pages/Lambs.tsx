import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { animalProvider, herdLocator, refreshHerdData } from '@fmis/core/animals'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import { errorText, notifyError, notifySuccess } from '@fmis/core/toast'
import { undoAction } from '@fmis/core/undo'
import { loadHerdData, moveAnimals, type HerdData } from '@fmis/tiere/lib/herds'
import { useQuery } from '../hooks/useQuery'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import HoldButton from '../components/HoldButton'
import JournalForm from '../components/JournalForm'
import { fmtDate, localTodayIso } from '../lib/format'
import { loadLambs, unmarkedLabel, WEAN_FROM_DAYS, type Lamb } from '../lib/lambs'
import { speciesOf } from '../lib/species'
import type { JournalCategory } from '../types'

type Action = '' | 'absetzen' | 'waegen' | 'fuetterung' | 'behandlung' | 'beobachtung'
const ACTIONS: { key: Exclude<Action, ''>; icon: string; label: string }[] = [
  { key: 'absetzen', icon: '✂️', label: 'Absetzen' },
  { key: 'waegen', icon: '⚖️', label: 'Wägen' },
  { key: 'fuetterung', icon: '🍼', label: 'Schoppen / Fütterung' },
  { key: 'behandlung', icon: '💉', label: 'Behandlung (Drenchen, Bolus …)' },
  { key: 'beobachtung', icon: '👁️', label: 'Beobachtung' },
]
const JOURNAL: Partial<Record<Action, JournalCategory>> = { fuetterung: 'fuetterung', behandlung: 'behandlung', beobachtung: 'beobachtung' }
type Status = 'alle' | 'saugend' | 'abgesetzt'

/** Lamm mit Anzeige: Nummer/Ohrmarke, ohne Ohrmarke der Meldezeitpunkt der Ablammung */
type Row = Lamb & { title: string }
const label = (l: Row) => l.title

/** Lämmer (Kälber): Übersicht mit Filtern, Mehrfachauswahl und Aktionen. Eine gewählte
 * Aktion zeigt nur die Tiere, für die sie in Frage kommt. ?aktion=…, ?mutter=<id,…> wählt
 * die saugenden Lämmer dieser Mütter vor, ?tier=<id> ein einzelnes. */
export default function Lambs({ moduleKey }: { moduleKey: string }) {
  const sheep = speciesOf(moduleKey) === 'sheep'
  const word = sheep ? { one: 'Lamm', many: 'Lämmer' } : { one: 'Kalb', many: 'Kälber' }
  const today = localTodayIso()
  const [params] = useSearchParams()
  const { data, loading } = useQuery(async (pg) => {
    const [lambs, dams] = await Promise.all([
      loadLambs(pg, today),
      pg.query<{ id: string; lauf_nr: string | null; ear_tag: string }>('select id, lauf_nr, ear_tag from animals where deleted_at is null'),
    ])
    return { lambs, damLabel: new Map(dams.rows.map((d) => [d.id, d.lauf_nr ?? shortEarTag(d.ear_tag)])) }
  }, [today])
  const lambs = useMemo<Row[]>(
    () =>
      (data?.lambs ?? []).map((l) => ({
        ...l,
        title: l.earTag ? `${l.lauf_nr ? `${l.lauf_nr} · ` : ''}${shortEarTag(l.earTag)}` : unmarkedLabel(l, l.damId ? (data?.damLabel.get(l.damId) ?? null) : null),
      })),
    [data],
  )

  // Tiergruppe je Tier (Modul Tiere, lädt langsamer)
  const [groupOf, setGroupOf] = useState<Map<string, string>>(new Map())
  const taggedIds = lambs.flatMap((l) => (l.animalId ? [l.animalId] : [])).join(',')
  useEffect(() => {
    let live = true
    const load = () => herdLocator()?.groupNames?.(taggedIds.split(',').filter(Boolean), today).then((m) => live && setGroupOf(m))
    void load()
      ?.then(() => refreshHerdData())
      .then((fresh) => fresh && live && load())
    return () => {
      live = false
    }
  }, [taggedIds, today])

  const [action, setAction] = useState<Action>(() => (ACTIONS.some((a) => a.key === params.get('aktion')) ? (params.get('aktion') as Action) : ''))
  const [status, setStatus] = useState<Status>(() => (params.get('aktion') === 'absetzen' ? 'saugend' : 'alle'))
  const [dueOnly, setDueOnly] = useState(() => params.get('aktion') === 'absetzen' && !params.get('mutter') && !params.get('tier'))
  const [sex, setSex] = useState<'' | 'w' | 'm'>('')
  const [group, setGroup] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Vorauswahl aus dem Link, sobald die Liste da ist
  const [preselected, setPreselected] = useState(false)
  useEffect(() => {
    if (preselected || !data) return
    const dams = new Set((params.get('mutter') ?? '').split(',').filter(Boolean))
    const tier = params.get('tier')
    setSelected(new Set(lambs.filter((l) => (dams.size && l.damId && dams.has(l.damId) && l.nursing) || (tier && (l.animalId === tier || l.key === tier))).map((l) => l.key)))
    setPreselected(true)
  }, [data, lambs, params, preselected])

  const eligible = (l: Lamb) => (action === 'absetzen' ? l.nursing : true)
  const visible = lambs.filter(
    (l) =>
      eligible(l) &&
      (status === 'alle' || (status === 'saugend' ? l.nursing : !l.nursing)) &&
      (!dueOnly || l.ageDays >= WEAN_FROM_DAYS) &&
      (!sex || l.sex === sex) &&
      (!group || (group === '-' ? !groupOf.get(l.animalId ?? '') : groupOf.get(l.animalId ?? '') === group)) &&
      (!search.trim() ||
        [l.lauf_nr, l.earTag, l.damId ? data?.damLabel.get(l.damId) : null]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .replace(/[.\s]/g, '')
          .includes(search.toLowerCase().replace(/[.\s]/g, ''))),
  )
  const chosen = visible.filter((l) => selected.has(l.key))
  const groupNames = [...new Set(groupOf.values())].sort()
  const allSelected = visible.length > 0 && visible.every((l) => selected.has(l.key))

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }
  function chooseAction(a: Action) {
    setAction(a)
    if (a === 'absetzen') setStatus('saugend')
  }
  const done = () => setSelected(new Set())

  const chip = (on: boolean) => `min-h-11 rounded-full border px-3 text-sm ${on ? 'border-brand-700 bg-brand-700 font-semibold text-white' : 'border-gray-300 bg-white text-gray-800'}`
  const due = lambs.filter((l) => l.nursing && l.ageDays >= WEAN_FROM_DAYS).length

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-40">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">{word.many}</h1>
        <span className="text-sm text-gray-600">
          {lambs.filter((l) => l.nursing).length} saugend · {due} ab {WEAN_FROM_DAYS} Tagen
        </span>
      </div>

      <section className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
        <div className="text-sm font-medium text-gray-800">Aktion</div>
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.map((a) => (
            <button key={a.key} type="button" onClick={() => chooseAction(action === a.key ? '' : a.key)} className={chip(action === a.key)}>
              {a.icon} {a.label}
            </button>
          ))}
        </div>
        {action === 'behandlung' && <p className="text-xs text-gray-600">Drenchen und Boli sind Zwangsmassnahmen und kommen ins Behandlungsjournal. Häufige Mittel als Vorlage speichern (Behandlungsjournal).</p>}
      </section>

      <section className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-1.5">
          {(['alle', 'saugend', 'abgesetzt'] as Status[]).map((s) => (
            <button key={s} type="button" disabled={action === 'absetzen' && s !== 'saugend'} onClick={() => setStatus(s)} className={`${chip(status === s)} disabled:opacity-40`}>
              {s === 'alle' ? 'Alle' : s === 'saugend' ? '🍼 saugend' : 'abgesetzt'}
            </button>
          ))}
          <button type="button" onClick={() => setDueOnly((v) => !v)} className={chip(dueOnly)}>
            ab {WEAN_FROM_DAYS} Tagen
          </button>
          {(['', 'w', 'm'] as const).map((s) => (
            <button key={s || 'x'} type="button" onClick={() => setSex(s)} className={chip(sex === s)}>
              {s === '' ? '♀♂' : s === 'w' ? '♀' : '♂'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Suche: Nummer, Ohrmarke, Mutter" className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-base" />
          {groupNames.length > 0 && (
            <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Tiergruppe" className="min-h-11 rounded-lg border border-gray-300 bg-white px-2 text-sm">
              <option value="">alle Tiergruppen</option>
              {groupNames.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value="-">ohne Gruppe</option>
            </select>
          )}
        </div>
      </section>

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}
      {data && (
        <section className="rounded-lg bg-white shadow-sm">
          <label className="flex min-h-12 items-center gap-3 border-b px-3 text-sm text-gray-700">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((l) => l.key)))} className="h-5 w-5" />
            {visible.length} {visible.length === 1 ? word.one : word.many}
            {chosen.length > 0 && <b className="ml-auto text-brand-800">{chosen.length} gewählt</b>}
          </label>
          {visible.length === 0 && <p className="p-3 text-sm text-gray-600">Keine {word.many} für diese Auswahl.</p>}
          <ul className="divide-y">
            {visible.map((l) => {
              const g = l.animalId ? groupOf.get(l.animalId) : undefined
              const last = l.weights[l.weights.length - 1]
              return (
                <li key={l.key} className={selected.has(l.key) ? 'bg-brand-50' : ''}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                    <input type="checkbox" checked={selected.has(l.key)} onChange={() => toggle(l.key)} className="mt-1 h-5 w-5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2">
                        <b className={l.earTag ? 'text-gray-900' : 'font-semibold text-gray-700'}>{label(l)}</b>
                        <span className="text-gray-700">{l.sex === 'w' ? '♀' : l.sex === 'm' ? '♂' : ''}</span>
                        <span className="text-sm text-gray-700">{l.ageDays} T.</span>
                        {l.nursing ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${l.ageDays >= WEAN_FROM_DAYS ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}>
                            🍼 saugend{l.ageDays >= WEAN_FROM_DAYS ? ' · absetzen?' : ''}
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">abgesetzt{l.weanDate ? ` ${fmtDate(l.weanDate)}` : ''}</span>
                        )}
                      </span>
                      <span className="block text-xs text-gray-600">
                        {/* ohne Ohrmarke stehen Mutter und Wurf schon in der Kennung */}
                        {!l.earTag ? 'ohne Ohrmarke' : l.damId ? `Mutter ${data.damLabel.get(l.damId) ?? '?'}` : 'Mutter unbekannt'}
                        {l.earTag && l.litter > 1 ? ` · Wurf ${l.litter}` : ''}
                        {l.birthWeight != null ? ` · Geburt ${l.birthWeight} kg` : ''}
                        {last ? ` · ${last.kg} kg am ${fmtDate(last.date)}` : ''}
                        {l.gainPerDay != null ? ` (${l.gainPerDay} g/Tag)` : ''}
                        {g ? ` · ${g}` : ''}
                      </span>
                    </span>
                    {l.animalId && (
                      <Link to={`../tiere/${l.animalId}`} relative="path" onClick={(e) => e.stopPropagation()} className="flex min-h-11 items-center px-1 text-brand-700" aria-label="Zum Tier">
                        ›
                      </Link>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {action && (
        <section className="sticky bottom-16 space-y-2 rounded-lg border border-brand-200 bg-white p-3 shadow-lg">
          {chosen.length === 0 ? (
            <p className="text-sm text-gray-700">{word.many} oben antippen, dann hier {ACTIONS.find((a) => a.key === action)?.label}.</p>
          ) : action === 'absetzen' ? (
            <WeanPanel moduleKey={moduleKey} lambs={chosen} word={word} onDone={done} />
          ) : action === 'waegen' ? (
            <WeighPanel lambs={chosen} onDone={done} />
          ) : (
            <>
              <div className="text-sm font-medium text-gray-800">
                {chosen.length} {chosen.length === 1 ? word.one : word.many}: {chosen.map(label).join(', ')}
              </div>
              <JournalForm
                key={action}
                animalIds={chosen.flatMap((l) => (l.animalId ? [l.animalId] : []))}
                unmarked={chosen.flatMap((l) => (!l.animalId && l.offspringId ? [{ offspringId: l.offspringId, label: `Lamm ohne Ohrmarke, ${l.title}` }] : []))}
                defaultCategory={JOURNAL[action]}
                defaultText={action === 'fuetterung' ? 'Schoppen' : ''}
                onSaved={() => {
                  notifySuccess('Gespeichert')
                  done()
                }}
              />
            </>
          )}
        </section>
      )}
    </div>
  )
}

function WeanPanel({ moduleKey, lambs: chosenLambs, word, onDone }: { moduleKey: string; lambs: Row[]; word: { one: string; many: string }; onDone: () => void }) {
  const db = useDb()
  const today = localTodayIso()
  const sheep = speciesOf(moduleKey) === 'sheep'
  const [date, setDate] = useState(today)
  const [herd, setHerd] = useState<HerdData | null>(null)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void loadHerdData().then(setHerd)
  }, [])
  const groups = (herd?.groups ?? []).filter((g) => g.active && g.species === (sheep ? 'schafe' : 'rinder'))
  const untagged = chosenLambs.filter((l) => !l.animalId).length

  async function run() {
    const toGroup = groups.find((g) => g.id === target) ?? null
    setBusy(true)
    try {
      await undoAction(`${chosenLambs.length} ${chosenLambs.length === 1 ? word.one : word.many} abgesetzt`, async () => {
        await inTransaction(db, async (tx) => {
          for (const l of chosenLambs) {
            await upsertRow(tx, 'weanings', {
              id: crypto.randomUUID(),
              offspring_id: l.offspringId,
              animal_id: l.animalId,
              wean_date: date,
              herd_group: toGroup?.name ?? null,
              notes: null,
              created_by: getCurrentUserEmail(),
            })
          }
        })
        if (toGroup && herd) {
          const ids = new Set(chosenLambs.flatMap((l) => (l.animalId ? [l.animalId] : [])))
          const refs = ((await animalProvider(moduleKey)?.listAnimals()) ?? []).filter((r) => ids.has(r.id))
          if (refs.length) await moveAnimals(herd, { toGroup, fromGroup: null, date, animals: refs, counts: {}, dryOff: false })
        }
      })
      notifySuccess(`${chosenLambs.length} abgesetzt${target ? ` → «${groups.find((g) => g.id === target)?.name}»` : ''}`)
      onDone()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium text-gray-800">
        {chosenLambs.length} {chosenLambs.length === 1 ? word.one : word.many} absetzen: {chosenLambs.map(label).join(', ')}
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-2" aria-label="Datum" />
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2" aria-label="Tiergruppe">
          <option value="">{herd ? 'Tiergruppe nicht ändern' : 'Tiergruppen laden …'}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              nach «{g.name}»
            </option>
          ))}
        </select>
      </div>
      {target && untagged > 0 && <p className="text-xs text-amber-800">{untagged} ohne Ohrmarke: in den Tiergruppen als Anzahl ohne Nummer von Hand anpassen.</p>}
      <HoldButton disabled={busy} label={busy ? 'speichert …' : `Gedrückt halten: ${chosenLambs.length} absetzen`} onDone={() => void run()} />
    </div>
  )
}

function WeighPanel({ lambs: chosenLambs, onDone }: { lambs: Row[]; onDone: () => void }) {
  const db = useDb()
  const today = localTodayIso()
  const [date, setDate] = useState(today)
  const [kg, setKg] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const filled = chosenLambs.filter((l) => Number(kg[l.key]) > 0)

  async function save() {
    setBusy(true)
    try {
      await undoAction(`${filled.length} Gewichte`, () =>
        inTransaction(db, async (tx) => {
          for (const l of filled) {
            await upsertRow(tx, 'animal_weights', {
              id: crypto.randomUUID(),
              animal_id: l.animalId,
              offspring_id: l.offspringId,
              weigh_date: date,
              weight_kg: Math.round(Number(kg[l.key]) * 10) / 10,
              notes: null,
              created_by: getCurrentUserEmail(),
            })
          }
        }),
      )
      notifySuccess(`${filled.length} Gewichte gespeichert`)
      onDone()
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-gray-700">Wägung am</span>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-lg border border-gray-300 px-2" />
      </label>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {chosenLambs.map((l) => (
          <li key={l.key} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{label(l)}</span>
            <NumberInput min={0} step={0.1} value={kg[l.key] ?? ''} placeholder="kg" onChange={(e) => setKg((k) => ({ ...k, [l.key]: e.target.value }))} className="min-h-11 w-24 rounded-lg border border-gray-300 px-2 text-right" aria-label={`Gewicht ${label(l)}`} />
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy || filled.length === 0} onClick={() => void save()} className="min-h-12 w-full rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-50">
        {busy ? 'speichert …' : `${filled.length} Gewichte speichern`}
      </button>
    </div>
  )
}
