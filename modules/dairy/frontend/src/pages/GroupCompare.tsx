import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useDb } from '@fmis/core/DbContext'
import { shortEarTag } from '@fmis/core/earTag'
import NumberInput from '@fmis/core/NumberInput'
import { notifyError } from '@fmis/core/toast'
import { useQuery } from '../hooks/useQuery'
import AnimalPicker from '../components/AnimalPicker'
import { clawStatusByAnimal, loadClawExams } from '../lib/clawHealth'
import { animalMetrics, bestIndex, DEFAULT_GROUP_SETTINGS, metricDefs, type AnimalMetrics, type GroupSettings } from '../lib/groupCompare'
import { rankLambs } from '../lib/lambSelection'
import { loadLambSelection } from '../lib/lambSelectionData'
import { fmtDate, localTodayIso } from '../lib/format'
import { speciesOf } from '../lib/species'
import { addToWatchlist, createWatchlist, loadWatchlists } from '../lib/watchlists'
import { loadSettings } from './LambSelection'
import type { Animal } from '../types'

async function loadData(pg: PGlite, species: 'cattle' | 'sheep', moduleKey: string) {
  const today = localTodayIso()
  const [sel, claws, lists] = await Promise.all([loadLambSelection(pg, species, today), loadClawExams(pg), loadWatchlists(pg)])
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
    ...lists,
  }
}

const settingsKey = (k: string) => `${k}_group_compare`
const selectionKey = (k: string) => `${k}_group_compare_groups`
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
}
const COLORS = ['border-sky-600 bg-sky-600', 'border-amber-600 bg-amber-600', 'border-violet-600 bg-violet-600', 'border-teal-700 bg-teal-700']
const label = (a: Animal) => `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${shortEarTag(a.ear_tag)}`

/** Beliebige Gruppen zusammenstellen und nebeneinander vergleichen. */
export default function GroupCompare({ moduleKey }: { moduleKey: string }) {
  const db = useDb()
  const species = speciesOf(moduleKey)
  const word = species === 'sheep' ? { young: 'Lämmer', mothers: 'Auen mit Ablammung' } : { young: 'Kälber/Rinder', mothers: 'Kühe mit Abkalbung' }
  const { data, loading } = useQuery((pg) => loadData(pg, species, moduleKey), [species, moduleKey])
  const [settings, setSettings] = useState<GroupSettings>(() => readJson(settingsKey(moduleKey), DEFAULT_GROUP_SETTINGS[species]))
  const [showSettings, setShowSettings] = useState(false)
  const [selected, setSelected] = useState<string[]>(() => readJson<{ keys: string[] }>(selectionKey(moduleKey), { keys: ['muetter'] }).keys)
  const [tab, setTab] = useState(0)
  const [building, setBuilding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIds, setNewIds] = useState<string[]>([])
  const [sort, setSort] = useState<{ key: keyof AnimalMetrics | 'name'; desc: boolean }>({ key: 'name', desc: false })

  function updateSettings(next: GroupSettings) {
    setSettings(next)
    writeJson(settingsKey(moduleKey), next)
  }
  function select(keys: string[]) {
    setSelected(keys)
    writeJson(selectionKey(moduleKey), { keys })
    setTab((t) => Math.min(t, Math.max(0, keys.length - 1)))
  }

  const active = useMemo(() => [...(data?.context.values() ?? [])].filter((c) => c.animal.status === 'aktiv'), [data])
  const allAnimals = useMemo(() => active.map((c) => c.animal), [active])
  const groups = useMemo<Group[]>(() => {
    if (!data) return []
    const youngDays = settings.youngMaxDays
    const age = (b: string | null) => (b ? (Date.parse(data.today) - Date.parse(b)) / 86_400_000 : Infinity)
    const fixed: Group[] = [
      { key: 'alle', name: 'Alle aktiven', ids: active.map((c) => c.animal.id) },
      { key: 'muetter', name: word.mothers, ids: active.filter((c) => c.animal.sex !== 'm' && (c.births.length > 0 || c.lactationNumber)).map((c) => c.animal.id) },
      { key: 'jung', name: word.young, ids: active.filter((c) => age(c.animal.birth_date) < youngDays).map((c) => c.animal.id) },
    ]
    const activeIds = new Set(active.map((c) => c.animal.id))
    const lists = data.lists
      .filter((l) => !l.archived_at)
      .map((l) => ({ key: l.id, name: l.name, ids: data.entries.filter((e) => e.list_id === l.id && !e.done_at && activeIds.has(e.animal_id)).map((e) => e.animal_id) }))
    return [...fixed, ...lists]
  }, [data, active, settings.youngMaxDays, word.mothers, word.young])
  const chosen = selected.map((k) => groups.find((g) => g.key === k)).filter((g): g is Group => !!g)

  const metricsById = useMemo(() => {
    const m = new Map<string, AnimalMetrics>()
    if (!data) return m
    for (const c of active) m.set(c.animal.id, animalMetrics(c, species, data.today, settings, data.lambByAnimal.get(c.animal.id), data.claws.get(c.animal.id)))
    return m
  }, [data, active, species, settings])
  const defs = useMemo(() => metricDefs(species), [species])
  const groupMetrics = chosen.map((g) => g.ids.map((id) => metricsById.get(id)).filter((m): m is AnimalMetrics => !!m))

  async function saveGroup() {
    if (!newName.trim() || newIds.length === 0) return
    try {
      const id = await createWatchlist(db, newName)
      await addToWatchlist(db, id, newIds, null)
      select([...selected.filter((k) => k !== id), id].slice(-4))
      setBuilding(false)
      setNewName('')
      setNewIds([])
    } catch (e) {
      notifyError(e instanceof Error ? e.message : String(e))
    }
  }

  const sections = [...new Set(defs.map((d) => d.section))]
  const tabGroup = chosen[tab]
  const rows = tabGroup ? tabGroup.ids.map((id) => ({ a: data!.context.get(id)!.animal, m: metricsById.get(id)! })).filter((r) => r.a && r.m) : []
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
        <h1 className="text-xl font-bold text-gray-900">Gruppen vergleichen</h1>
        <button type="button" onClick={() => setShowSettings((v) => !v)} className="min-h-10 rounded-lg border border-gray-300 px-3 text-sm text-gray-700">
          ⚙️ Preise
        </button>
      </div>

      {showSettings && (
        <div className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm">
          {(
            [
              ['priceYoung', species === 'sheep' ? 'Lämmer (LA T3), CHF/kg SG' : 'Jungtiere, CHF/kg SG', 0.05],
              ['carcassYoung', species === 'sheep' ? 'Schlachtgewicht Lamm, kg' : 'Schlachtgewicht Jungtier, kg', 0.5],
              ['priceAdult', species === 'sheep' ? 'Schafe (SM T3), CHF/kg SG' : 'Kühe, CHF/kg SG', 0.05],
              ['carcassAdult', species === 'sheep' ? 'Schlachtgewicht Aue, kg' : 'Schlachtgewicht Kuh, kg', 0.5],
              ['minAgeMonths', 'Jungtier schlachtreif ab, Monate', 0.5],
              ['youngMaxDays', species === 'sheep' ? 'Lamm bis Alter, Tage' : 'Jungtier bis Alter, Tage', 1],
            ] as [keyof GroupSettings, string, number][]
          ).map(([k, l, step]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-gray-700">
              {l}
              <NumberInput
                min={0}
                step={step}
                value={settings[k] ?? ''}
                placeholder="?"
                onChange={(e) => updateSettings({ ...settings, [k]: e.target.value === '' ? (k === 'minAgeMonths' || k === 'youngMaxDays' ? DEFAULT_GROUP_SETTINGS[species][k] : null) : Math.max(0, Number(e.target.value) || 0) })}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-right"
              />
            </label>
          ))}
          <p className="text-xs text-gray-600">Ohne Gewicht oder Preis bleibt der Erlös leer. Erlös = Schlachtgewicht × Preis; Jungtiere erst ab dem Mindestalter.</p>
          <button type="button" onClick={() => updateSettings(DEFAULT_GROUP_SETTINGS[species])} className="text-xs text-brand-700">
            Vorgaben wiederherstellen
          </button>
        </div>
      )}

      <section className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
        <div className="text-sm font-medium text-gray-800">Gruppen wählen (bis 4)</div>
        <div className="flex flex-wrap gap-1.5">
          {groups.map((g) => {
            const i = selected.indexOf(g.key)
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => select(i >= 0 ? selected.filter((k) => k !== g.key) : [...selected, g.key].slice(-4))}
                className={`min-h-10 rounded-full border-2 px-3 text-sm ${i >= 0 ? `${COLORS[i]} font-semibold text-white` : 'border-gray-300 bg-white text-gray-800'}`}
              >
                {g.name} <span className="opacity-80">({g.ids.length})</span>
              </button>
            )
          })}
          <button type="button" onClick={() => setBuilding((b) => !b)} className="min-h-10 rounded-full border-2 border-dashed border-brand-700 px-3 text-sm font-semibold text-brand-800">
            + Gruppe zusammenstellen
          </button>
        </div>
        {building && (
          <div className="space-y-2 rounded-lg bg-gray-50 p-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name der Gruppe, z.B. Erstlaktierende" className="min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base" />
            <AnimalPicker animals={allAnimals} selected={newIds} onChange={setNewIds} multiple readerModule={moduleKey} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-600">Wird als Merkliste gespeichert und lässt sich dort ändern.</span>
              <button type="button" disabled={!newName.trim() || newIds.length === 0} onClick={() => void saveGroup()} className="min-h-11 shrink-0 rounded-lg bg-brand-700 px-3 font-semibold text-white disabled:opacity-40">
                Speichern ({newIds.length})
              </button>
            </div>
          </div>
        )}
      </section>

      {loading && !data && <p className="text-center text-gray-500">Lädt…</p>}

      {chosen.length > 0 && (
        <section className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 bg-white px-2 py-2 text-left font-medium text-gray-600">Kennzahl (Ø)</th>
                {chosen.map((g, i) => (
                  <th key={g.key} className="px-2 py-2 text-right">
                    <span className={`inline-block max-w-28 truncate rounded px-1.5 py-0.5 text-xs font-semibold text-white ${COLORS[i]}`}>{g.name}</span>
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
          <p className="px-2 py-1.5 text-xs text-gray-500">Grün = bester Wert der Zeile. n = Tiere mit Wert, wenn nicht alle einen haben.</p>
        </section>
      )}

      {chosen.length > 0 && tabGroup && (
        <section className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {chosen.map((g, i) => (
              <button key={g.key} type="button" onClick={() => setTab(i)} className={`min-h-10 rounded-lg border-2 px-3 text-sm ${tab === i ? `${COLORS[i]} font-semibold text-white` : 'border-gray-300 bg-white'}`}>
                {g.name}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
            <table className="w-full text-xs">
              <thead className="border-b text-gray-600">
                <tr>
                  {col('name', 'Tier')}
                  {col('ageMonths', 'Alter Mt.')}
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
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-1.5 py-1.5">
                      <Link to={`../kuehe/${a.id}`} relative="path" className="font-medium text-brand-700">
                        {label(a)}
                      </Link>
                      {m.pregnant && <span title="trächtig gemeldet"> 🤰</span>}
                      {m.lame && <span title="lahm"> 🐾</span>}
                    </td>
                    <td className="px-1.5 tabular-nums">{num(m.ageMonths)}</td>
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
      {chosen.length === 0 && data && <p className="rounded-lg bg-white p-4 text-sm text-gray-700 shadow-sm">Eine oder mehrere Gruppen wählen. Eigene Gruppen sind Merklisten.</p>}
    </div>
  )
}
