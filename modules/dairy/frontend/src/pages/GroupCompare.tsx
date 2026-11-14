import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { herdLocator, refreshHerdData } from '@fmis/core/animals'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import SettingsEditor, { ReadValue } from '@fmis/core/SettingsEditor'
import { notifyError, errorText } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import AnimalPicker from '../components/AnimalPicker'
import { ActionChips, ActionPanel, eligibleFor, type ListAction } from '../components/ListActions'
import { loadLambs, nursingByDam } from '../lib/lambs'
import { useProviandePrices } from '../lib/proviandePrices'
import { clawStatusByAnimal, loadClawExams } from '../lib/clawHealth'
import { animalMetrics, bestIndex, DEFAULT_GROUP_SETTINGS, metricDefs, type AnimalMetrics, type GroupSettings } from '../lib/groupCompare'
import { rankLambs } from '../lib/lambSelection'
import { loadLambSelection } from '../lib/lambSelectionData'
import { fmtAge, fmtDate, localTodayIso } from '../lib/format'
import { speciesOf } from '../lib/species'
import { addToWatchlist, createWatchlist, loadWatchlists } from '../lib/watchlists'
import { loadSettings } from './LambSelection'
import type { Animal } from '../types'

async function loadData(pg: PGlite, species: 'cattle' | 'sheep', moduleKey: string) {
  const today = localTodayIso()
  const [sel, claws, lists, young] = await Promise.all([loadLambSelection(pg, species, today), loadClawExams(pg), loadWatchlists(pg), loadLambs(pg, today)])
  const lambs = rankLambs({
    candidates: sel.candidates,
    dams: sel.dams,
    sireValues: sel.sireValues,
    inbreeding: (dam, sire) => sel.inbreeding.offspring(dam, sire),
    decisions: new Map([...sel.decisions].map(([k, d]) => [k, d.purpose])),
    settings: { ...loadSettings(moduleKey), maxAgeMonths: 24 },
    today,
  })
  return {
    today,
    context: sel.context,
    lambByAnimal: new Map(lambs.filter((l) => l.animal_id).map((l) => [l.animal_id!, l])),
    claws: clawStatusByAnimal(claws, species, today),
    nursing: nursingByDam(young),
    nursingLambs: young.filter((l) => l.nursing && l.animalId).map((l) => l.animalId!),
    ...lists,
  }
}

const settingsKey = (k: string) => `${k}_group_compare`
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // nur bis zum Neuladen
  }
}

interface Group {
  key: string
  name: string
  ids: string[]
  kind: 'fest' | 'herde' | 'liste'
}
const KINDS: [Group['kind'], string][] = [
  ['fest', 'Übersicht'],
  ['herde', 'Tiergruppen'],
  ['liste', 'Merklisten'],
]
type HerdGroups = { id: string; name: string; animalIds: string[] }[]

/** Leistungsseite für die Tiere einer Gruppe; «Alle aktiven» ohne Einschränkung. */
function performanceLink(g: Group): string {
  if (g.key === 'alle') return '../leistung'
  return `../leistung?${new URLSearchParams({ tiere: g.ids.join(','), gruppe: g.name })}`
}
const COLORS = ['border-sky-600 bg-sky-600', 'border-amber-600 bg-amber-600', 'border-violet-600 bg-violet-600', 'border-teal-700 bg-teal-700']
const label = (a: Animal) => `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}`

/** Gruppen: Liste der festen Gruppen, Tiergruppen (Modul Tiere) und Merklisten; ein Tipp zeigt
 * die Tiere einer Gruppe mit Aktionen (?gruppe=…), «Vergleichen» die Mittelwerte mehrerer
 * Gruppen nebeneinander (?vergleich=a,b). */
export default function GroupCompare({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const word = species === 'sheep'
    ? { young: 'Lämmer', mothers: 'Auen mit Ablammung', withYoung: '🍼 Auen mit Lämmern', nursing: '🍼 Saugende Lämmer' }
    : { young: 'Kälber/Rinder', mothers: 'Kühe mit Abkalbung', withYoung: '🍼 Kühe mit Kälbern', nursing: '🍼 Saugende Kälber' }
  const { data, loading } = useQuery((pg) => loadData(pg, species, moduleKey), [species, moduleKey])
  const [stored, setSettings] = useState<GroupSettings>(() => readJson(settingsKey(moduleKey), DEFAULT_GROUP_SETTINGS[species]))
  // Preise: Proviande-Woche, solange keine eigenen gewählt sind
  const proviande = useProviandePrices(species)
  const settings = useMemo<GroupSettings>(
    () => (!stored.ownPrices && proviande ? { ...stored, priceYoung: proviande.young ?? stored.priceYoung, priceAdult: proviande.adult ?? stored.priceAdult } : stored),
    [stored, proviande],
  )
  const [showSettings, setShowSettings] = useState(false)
  const [params, setParams] = useSearchParams()
  const openKey = params.get('gruppe')
  const compareKeys = (params.get('vergleich') ?? '').split(',').filter(Boolean)
  const [comparing, setComparing] = useState(false)
  const [marked, setMarked] = useState<string[]>([])
  const [building, setBuilding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIds, setNewIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [sort, setSort] = useState<{ key: keyof AnimalMetrics | 'name'; desc: boolean }>({ key: 'name', desc: false })
  // Aktion für Tiere der gewählten Gruppe: Liste zeigt dann nur, wofür sie in Frage kommt
  const [action, setAction] = useState<ListAction | ''>('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Tiergruppen gehören dem Modul Tiere (wie in den Merklisten: erst lesen, nach dem Abgleich nochmals)
  const [herdGroups, setHerdGroups] = useState<HerdGroups>([])
  useEffect(() => {
    let live = true
    const load = () => herdLocator()?.groups?.(localTodayIso()).then((g) => live && setHerdGroups(g))
    void load()
      ?.then(() => refreshHerdData())
      .then((fresh) => fresh && live && load())
    return () => {
      live = false
    }
  }, [])

  function updateSettings(next: GroupSettings) {
    setSettings(next)
    writeJson(settingsKey(moduleKey), next)
  }
  function open(key: string) {
    setAction('')
    setPicked(new Set())
    setParams({ gruppe: key })
  }

  const active = useMemo(() => [...(data?.context.values() ?? [])].filter((c) => c.animal.status === 'aktiv'), [data])
  const allAnimals = useMemo(() => active.map((c) => c.animal), [active])
  const groups = useMemo<Group[]>(() => {
    if (!data) return []
    const youngDays = settings.youngMaxDays
    const age = (b: string | null) => (b ? (Date.parse(data.today) - Date.parse(b)) / 86_400_000 : Infinity)
    const fixed: Group[] = [
      { key: 'alle', kind: 'fest', name: 'Alle aktiven', ids: active.map((c) => c.animal.id) },
      { key: 'muetter', kind: 'fest', name: word.mothers, ids: active.filter((c) => c.animal.sex !== 'm' && (c.births.length > 0 || c.lactationNumber)).map((c) => c.animal.id) },
      { key: 'jung', kind: 'fest', name: word.young, ids: active.filter((c) => age(c.animal.birth_date) < youngDays).map((c) => c.animal.id) },
      // saugend: bis abgesetzt, unabhängig von der Tiergruppe (lib/lambs.ts)
      { key: 'mit_jungen', kind: 'fest', name: word.withYoung, ids: active.filter((c) => data.nursing.has(c.animal.id)).map((c) => c.animal.id) },
      { key: 'saugend', kind: 'fest', name: word.nursing, ids: data.nursingLambs.filter((id) => active.some((c) => c.animal.id === id)) },
    ]
    const activeIds = new Set(active.map((c) => c.animal.id))
    // nur Gruppen mit Tieren dieser Herde (Kühe und Schafe teilen sich das Modul Tiere)
    const herds = herdGroups
      .map((h): Group => ({ key: `herde:${h.id}`, kind: 'herde', name: h.name, ids: h.animalIds.filter((id) => activeIds.has(id)) }))
      .filter((h) => h.ids.length > 0)
    const lists = data.lists
      .filter((l) => !l.archived_at)
      .map((l): Group => ({ key: l.id, kind: 'liste', name: l.name, ids: [...new Set(data.entries.filter((e) => e.list_id === l.id && !e.done_at && activeIds.has(e.animal_id)).map((e) => e.animal_id))] }))
    return [...fixed, ...herds, ...lists]
  }, [data, active, herdGroups, settings.youngMaxDays, word.mothers, word.young, word.withYoung, word.nursing])
  const chosen = compareKeys.map((k) => groups.find((g) => g.key === k)).filter((g): g is Group => !!g)
  const tabGroup = openKey ? groups.find((g) => g.key === openKey) : undefined

  const metricsById = useMemo(() => {
    const m = new Map<string, AnimalMetrics>()
    if (!data) return m
    for (const c of active) m.set(c.animal.id, animalMetrics(c, species, data.today, settings, data.lambByAnimal.get(c.animal.id), data.claws.get(c.animal.id)))
    return m
  }, [data, active, species, settings])
  const defs = useMemo(() => metricDefs(species), [species])
  const groupMetrics = chosen.map((g) => g.ids.map((id) => metricsById.get(id)).filter((m): m is AnimalMetrics => !!m))

  async function saveGroup() {
    if (!newName.trim() || newIds.length === 0 || saving) return
    setSaving(true)
    try {
      const id = await createWatchlist(db, newName)
      await addToWatchlist(db, id, newIds, null)
      setBuilding(false)
      open(id)
      setNewName('')
      setNewIds([])
    } catch (e) {
      notifyError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const sections = [...new Set(defs.map((d) => d.section))]
  const rows = tabGroup
    ? tabGroup.ids.map((id) => ({ a: data!.context.get(id)!.animal, m: metricsById.get(id)! })).filter((r) => r.a && r.m && eligibleFor(action, r.a, data!.nursing))
    : []
  const sorted = [...rows].sort((x, y) => {
    const dir = sort.desc ? -1 : 1
    if (sort.key === 'name') return dir * (x.a.lauf_nr ?? x.a.ear_tag).localeCompare(y.a.lauf_nr ?? y.a.ear_tag, 'de', { numeric: true })
    const a = x.m[sort.key] as number | null
    const b = y.m[sort.key] as number | null
    if (a == null) return 1
    if (b == null) return -1
    return dir * (a - b)
  })
  const col = (key: keyof AnimalMetrics | 'name', text: string) => (
    <th className="px-1.5 py-1 text-left font-medium">
      <button type="button" onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : key !== 'name' })} className="whitespace-nowrap">
        {text}
        {sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
      </button>
    </th>
  )
  const num = (v: number | null, d = 0) => (v == null ? '–' : v.toFixed(d))

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 pb-24">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">Gruppen</h1>
        <button type="button" onClick={() => setShowSettings((v) => !v)} className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm text-gray-700">
          ⚙️ Preise
        </button>
      </div>

      {showSettings && (
        <SettingsEditor value={stored} onSave={updateSettings} onReset={() => DEFAULT_GROUP_SETTINGS[species]} label="Preise" className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm" title="Preise und Schlachtgewichte für den Erlös">
          {({ value, set, editing }) => {
            // Anzeige: Proviande-Wochenpreise, solange keine eigenen gewählt sind
            const eff: GroupSettings = !value.ownPrices && proviande ? { ...value, priceYoung: proviande.young ?? value.priceYoung, priceAdult: proviande.adult ?? value.priceAdult } : value
            return (
              <div className="mt-2 space-y-2">
                {proviande ? (
                  <label className="flex items-start gap-2 text-gray-800">
                    {editing ? (
                      <input type="checkbox" checked={!value.ownPrices} onChange={(e) => set({ ...value, ownPrices: !e.target.checked })} className="mt-1 h-5 w-5" />
                    ) : (
                      <span aria-hidden>{value.ownPrices ? '✏️' : '✓'}</span>
                    )}
                    <span>
                      Proviande-Wochenpreise Woche {proviande.week} (ab {fmtDate(proviande.validFrom)}): {proviande.youngLabel} {proviande.young?.toFixed(2) ?? '–'}, {proviande.adultLabel} {proviande.adult?.toFixed(2) ?? '–'} CHF/kg SG
                      {!editing && <span className="block text-xs text-gray-600">{value.ownPrices ? 'Es gelten eigene Preise.' : 'Diese Preise gelten.'}</span>}
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-gray-600">Proviande-Wochenpreise noch nicht da (holt der Server automatisch, im Mastplaner unter Vermarktung sichtbar).</p>
                )}
                {(
                  [
                    ['priceYoung', species === 'sheep' ? 'Lämmer (LA T3), CHF/kg SG' : 'Kälber (KV T3), CHF/kg SG', 0.05],
                    ['carcassYoung', species === 'sheep' ? 'Schlachtgewicht Lamm, kg' : 'Schlachtgewicht Jungtier, kg', 0.5],
                    ['priceAdult', species === 'sheep' ? 'Schafe (SM T3), CHF/kg SG' : 'Kühe (VK T3), CHF/kg SG', 0.05],
                    ['carcassAdult', species === 'sheep' ? 'Schlachtgewicht Aue, kg' : 'Schlachtgewicht Kuh, kg', 0.5],
                    ['minAgeMonths', 'Jungtier schlachtreif ab, Monate', 0.5],
                    ['youngMaxDays', species === 'sheep' ? 'Lamm bis Alter, Tage' : 'Jungtier bis Alter, Tage', 1],
                  ] as [Exclude<keyof GroupSettings, 'ownPrices'>, string, number][]
                ).map(([k, l, step]) => (
                  <label key={k} className="flex items-center justify-between gap-2 text-gray-700">
                    {l}
                    {editing ? (
                      <NumberInput
                        min={0}
                        step={step}
                        value={eff[k] ?? ''}
                        placeholder="?"
                        disabled={(k === 'priceYoung' || k === 'priceAdult') && !!proviande && !value.ownPrices}
                        onChange={(e) => set({ ...value, [k]: e.target.value === '' ? (k === 'minAgeMonths' || k === 'youngMaxDays' ? DEFAULT_GROUP_SETTINGS[species][k] : null) : Math.max(0, Number(e.target.value) || 0) })}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-right disabled:bg-gray-100"
                      />
                    ) : (
                      <ReadValue>{eff[k] ?? '–'}</ReadValue>
                    )}
                  </label>
                ))}
                <p className="text-xs text-gray-600">Ohne Gewicht oder Preis bleibt der Erlös leer. Erlös = Schlachtgewicht × Preis; Jungtiere erst ab dem Mindestalter.</p>
              </div>
            )
          }}
        </SettingsEditor>
      )}

      {!tabGroup && chosen.length === 0 && (
        <>
          {KINDS.map(([kind, title]) => {
            const list = groups.filter((g) => g.kind === kind)
            if (list.length === 0) return null
            return (
              <section key={kind} className="rounded-lg bg-white shadow-sm">
                <h2 className="px-3 pt-2.5 text-xs font-semibold uppercase tracking-wide text-gray-600">{title}</h2>
                <ul className="divide-y">
                  {list.map((g) => (
                    <li key={g.key}>
                      {comparing ? (
                        <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3">
                          <input
                            type="checkbox"
                            checked={marked.includes(g.key)}
                            onChange={() => setMarked((m) => (m.includes(g.key) ? m.filter((k) => k !== g.key) : [...m, g.key].slice(-4)))}
                            className="h-5 w-5"
                          />
                          <span className="flex-1 text-gray-900">{g.name}</span>
                          <span className="text-sm text-gray-600">{g.ids.length}</span>
                        </label>
                      ) : (
                        <button type="button" onClick={() => open(g.key)} className="flex min-h-12 w-full items-center gap-3 px-3 text-left active:bg-gray-50">
                          <span className="flex-1 text-gray-900">{g.name}</span>
                          <span className="text-sm text-gray-600">{g.ids.length}</span>
                          <span className="text-gray-400" aria-hidden>
                            ›
                          </span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {data && (
            <div className="flex flex-wrap gap-2">
              {comparing ? (
                <>
                  <button
                    type="button"
                    disabled={marked.length < 2}
                    onClick={() => {
                      setComparing(false)
                      setParams({ vergleich: marked.join(',') })
                    }}
                    className="min-h-11 flex-1 rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-40"
                  >
                    {marked.length < 2 ? 'Zwei bis vier Gruppen wählen' : `${marked.length} Gruppen vergleichen`}
                  </button>
                  <button type="button" onClick={() => setComparing(false)} className="min-h-11 rounded-lg border border-gray-300 px-3">
                    Abbrechen
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setComparing(true)} className="min-h-11 flex-1 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800">
                    📊 Gruppen vergleichen
                  </button>
                  <button type="button" onClick={() => setBuilding((b) => !b)} className="min-h-11 flex-1 rounded-lg border-2 border-dashed border-brand-700 px-3 text-sm font-semibold text-brand-800">
                    + Gruppe zusammenstellen
                  </button>
                </>
              )}
            </div>
          )}
          {building && (
            <div className="space-y-2 rounded-lg bg-gray-50 p-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name der Gruppe, z.B. Erstlaktierende" className="min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base" />
              <AnimalPicker animals={allAnimals} selected={newIds} onChange={setNewIds} multiple readerModule={moduleKey} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-600">Wird als Merkliste gespeichert und lässt sich dort ändern.</span>
                <button type="button" disabled={saving || !newName.trim() || newIds.length === 0} onClick={() => void saveGroup()} className="min-h-11 shrink-0 rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-40">
                  {saving ? 'speichert …' : `Speichern (${newIds.length})`}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {(tabGroup || chosen.length > 0) && (
        <button type="button" onClick={() => setParams({})} className="link-btn min-h-11 text-sm text-brand-700">
          ← alle Gruppen
        </button>
      )}

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}

      {chosen.length > 0 && (
        <section className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 bg-white px-2 py-2 text-left font-medium text-gray-600">Kennzahl (Ø)</th>
                {chosen.map((g, i) => (
                  <th key={g.key} className="px-2 py-2 text-right">
                    <button type="button" onClick={() => open(g.key)} className={`inline-block max-w-28 truncate rounded px-1.5 py-0.5 text-xs font-semibold text-white ${COLORS[i]}`}>
                      {g.name}
                    </button>
                    <span className="block text-xs font-normal text-gray-600">{groupMetrics[i].length} Tiere</span>
                  </th>
                ))}
              </tr>
            </thead>
            {sections.map((sec) => (
              <tbody key={sec}>
                <tr>
                  <td colSpan={chosen.length + 1} className="sticky left-0 bg-gray-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600">
                    {sec}
                  </td>
                </tr>
                {defs
                  .filter((d) => d.section === sec)
                  .map((d) => {
                    const vals = groupMetrics.map((ms) => d.value(ms))
                    const best = bestIndex(
                      vals.map((v) => v.value),
                      d.better,
                    )
                    if (vals.every((v) => v.value == null)) return null
                    return (
                      <tr key={d.label} className="border-t">
                        <td className="sticky left-0 bg-white px-2 py-1.5 text-gray-800">{d.label}</td>
                        {vals.map((v, i) => (
                          <td key={i} className={`px-2 py-1.5 text-right tabular-nums ${best === i ? 'font-bold text-green-800' : 'text-gray-900'}`}>
                            {v.value == null ? '–' : d.fmt(v.value)}
                            {v.value != null && v.n < groupMetrics[i].length && <span className="block text-[10px] text-gray-500">n={v.n}</span>}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
              </tbody>
            ))}
          </table>
          <p className="px-2 py-1.5 text-xs text-gray-500">Grün = bester Wert der Zeile. n = Tiere mit Wert, wenn nicht alle einen haben. Gruppenname antippen: Tiere der Gruppe.</p>
        </section>
      )}

      {tabGroup && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
              {tabGroup.name} <span className="text-sm font-normal text-gray-600">{tabGroup.ids.length} Tiere</span>
            </h2>
            <Link to={performanceLink(tabGroup)} relative="path" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700">
              🥛 Leistung →
            </Link>
          </div>
          <div className="space-y-1.5 rounded-lg bg-white p-2 shadow-sm">
            <div className="text-xs font-medium text-gray-600">Aktion für Tiere aus «{tabGroup.name}»</div>
            <ActionChips value={action} onChange={(a) => setAction(a)} moduleKey={moduleKey} />
          </div>
          <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
            <table className="w-full text-xs">
              <thead className="border-b text-gray-600">
                <tr>
                  {action && (
                    <th className="px-1.5 py-1">
                      <input
                        type="checkbox"
                        aria-label="alle wählen"
                        checked={sorted.length > 0 && sorted.every((r) => picked.has(r.a.id))}
                        onChange={(e) => setPicked(e.target.checked ? new Set(sorted.map((r) => r.a.id)) : new Set())}
                        className="h-5 w-5"
                      />
                    </th>
                  )}
                  {col('name', 'Tier')}
                  {col('ageMonths', 'Alter')}
                  {col('idxPerformance', 'Idx Leist.')}
                  {col('breedingValue', species === 'sheep' ? 'GZW' : 'ISET')}
                  {col('lambIndex', 'Idx Abst.')}
                  {col('daysSinceBirth', 'Tage s. Geb.')}
                  {col('revenue', 'Erlös')}
                  {col('interval', species === 'sheep' ? 'ZLZ' : 'ZKZ')}
                  {species === 'sheep' && col('litterMean', 'Wurf Ø')}
                  {species === 'sheep' && col('mh', 'MH')}
                </tr>
              </thead>
              <tbody className="divide-y">
                {sorted.map(({ a, m }) => (
                  <tr key={a.id} className={picked.has(a.id) ? 'bg-brand-50' : ''}>
                    {action && (
                      <td className="px-1.5">
                        <input
                          type="checkbox"
                          aria-label={`${label(a)} wählen`}
                          checked={picked.has(a.id)}
                          onChange={() =>
                            setPicked((s) => {
                              const n = new Set(s)
                              if (n.has(a.id)) n.delete(a.id)
                              else n.add(a.id)
                              return n
                            })
                          }
                          className="h-5 w-5"
                        />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-1.5 py-1.5">
                      <Link to={`../tiere/${a.id}`} relative="path" className="font-medium text-brand-700">
                        {label(a)}
                      </Link>
                      {m.pregnant && <span title="trächtig gemeldet"> 🤰</span>}
                      {m.lame && <span title="lahm"> 🐾</span>}
                      {data!.nursing.has(a.id) && <span title="saugende Junge"> 🍼{data!.nursing.get(a.id)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-1.5 tabular-nums">{fmtAge(a.birth_date, data!.today)}</td>
                    <td className="px-1.5 tabular-nums">{num(m.idxPerformance)}</td>
                    <td className="px-1.5 tabular-nums">{num(m.breedingValue)}</td>
                    <td className="px-1.5 tabular-nums">{num(m.lambIndex)}</td>
                    <td className="px-1.5 tabular-nums">{num(m.daysSinceBirth)}</td>
                    <td className="px-1.5 tabular-nums">{num(m.revenue)}</td>
                    <td className="px-1.5 tabular-nums">{num(m.interval)}</td>
                    {species === 'sheep' && <td className="px-1.5 tabular-nums">{num(m.litterMean, 1)}</td>}
                    {species === 'sheep' && <td className={`px-1.5 tabular-nums ${(m.mh ?? 0) >= 3 ? 'font-bold text-red-700' : ''}`}>{num(m.mh)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {action && (
            <div className="sticky bottom-16 rounded-lg border border-brand-200 bg-white p-3 shadow-lg">
              <ActionPanel moduleKey={moduleKey} action={action} ids={sorted.filter((r) => picked.has(r.a.id)).map((r) => r.a.id)} onDone={() => setPicked(new Set())} />
            </div>
          )}
          {sorted.some((r) => r.m.expectedBirth) && (
            <p className="text-xs text-gray-600">
              Erwartete Geburten in «{tabGroup.name}»:{' '}
              {sorted
                .filter((r) => r.m.expectedBirth)
                .map((r) => r.m.expectedBirth!)
                .sort()
                .filter((_, i, xs) => i === 0 || i === xs.length - 1)
                .map(fmtDate)
                .join(' – ')}
            </p>
          )}
        </section>
      )}
      {openKey && data && !tabGroup && <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">Diese Gruppe gibt es nicht mehr oder sie ist leer.</p>}
    </div>
  )
}
