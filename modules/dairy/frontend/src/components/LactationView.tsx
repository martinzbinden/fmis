import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, isoDate, num, todayIso } from '../lib/format'
import { computeHerdPerformance } from '../lib/herdPerformance'
import { sqlDate } from '../lib/importMerge'
import { speciesOf, speciesTerms } from '../lib/species'
import {
  ANIMAL_SORT_LABEL,
  calvingYears,
  CLOSURE_LABEL,
  CLOSURE_SHORT,
  DEFAULT_FILTER,
  fePerDay,
  groupByAnimal,
  isRunning,
  matchesCurve,
  matchesLactation,
  sortAnimals,
  sortRows,
  type AnimalLactations,
  type AnimalSort,
  type LactationFilter,
  type LactationRow,
  type LifetimeYield,
  type RowSort,
} from '../lib/lactationView'
import { animalLabel } from '@fmis/core/earTag'
import {
  analyzeLactations,
  bandFor,
  expectedTotal,
  buildHerdReference,
  buildTestDayModel,
  curveClass,
  curveKey,
  CURVE_CLASS_LABEL,
  parityGroup,
  quantile,
  quartileBounds,
  quartileOf,
  type CurveClass,
  type CurveMetric,
  type TestPoint,
} from '../lib/lactationCurves'
import { CLASS_COLOR, HerdDimChart, HerdScatter, LactationCurveChart, MiniCurve, POSITION_COLOR, type DimPoint, type ScatterPoint } from './CurveCharts'
import { herdSnapshot, weighingDays } from '../lib/herdSnapshot'
import TrendBadge from './TrendBadge'
import { trendsByAnimal } from '../lib/lactationTrend'

/** Lebenstagleistung je aktivem weiblichem Tier — dieselbe Rechnung wie
 * Ausmerzliste und Lämmer-Selektion (lib/herdPerformance.ts, Herdenvergleich
 * unter Tieren mit gleich vielen Laktationen). */
async function loadLifetimeYield(pg: PGlite): Promise<Map<string, LifetimeYield>> {
  const [{ rows: animals }, { rows: lactations }] = await Promise.all([
    pg.query<{ id: string; birth_date: unknown }>("select id, birth_date from animals where deleted_at is null and status = 'aktiv' and sex is distinct from 'm'"),
    pg.query<Record<string, unknown>>(
      'select animal_id, lactation_number, closure_type, milk_kg, fat_kg, protein_kg, days_in_milk, calving_date from lactations where deleted_at is null',
    ),
  ])
  const byAnimal = new Map<string, Record<string, unknown>[]>()
  for (const l of lactations) byAnimal.set(String(l.animal_id), [...(byAnimal.get(String(l.animal_id)) ?? []), l])
  const metrics = computeHerdPerformance(
    animals.map((a) => ({
      id: a.id,
      birth_date: isoDate(a.birth_date),
      lactations: (byAnimal.get(a.id) ?? []).map((l) => ({
        lactation_number: num(l.lactation_number)!,
        closure_type: num(l.closure_type)!,
        milk_kg: num(l.milk_kg),
        fat_kg: num(l.fat_kg),
        protein_kg: num(l.protein_kg),
        days_in_milk: num(l.days_in_milk),
        calving_date: isoDate(l.calving_date),
      })),
      tests: [],
    })),
    todayIso(),
  )
  // Vergleich erst ab einer abgeschlossenen Laktation: mitten in der ersten
  // hängt die LTL vor allem davon ab, wie weit diese schon ist.
  return new Map([...metrics].map(([id, m]) => [id, { milk: m.ltl_milk, fe: m.ltl_fe, feRel: m.n_lactations > 0 ? m.ltl_fe_rel : null }]))
}

async function loadTests(pg: PGlite): Promise<TestPoint[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    `select animal_id, lactation_number, calving_date, test_date, milk_kg, fat_pct, protein_pct
     from milk_tests where deleted_at is null and calving_date is not null and lactation_number is not null`,
  )
  return rows.map((t) => ({
    animal_id: String(t.animal_id),
    lactation_number: num(t.lactation_number)!,
    calving_date: isoDate(t.calving_date)!,
    test_date: isoDate(t.test_date)!,
    milk_kg: num(t.milk_kg) ?? 0,
    fat_pct: num(t.fat_pct),
    protein_pct: num(t.protein_pct),
  }))
}

async function loadLactations(pg: PGlite): Promise<{ rows: LactationRow[]; ltl: Map<string, LifetimeYield>; tests: TestPoint[] }> {
  const [{ rows }, ltl, tests] = await Promise.all([
    pg.query<LactationRow>(
      `select s.*, a.lauf_nr, a.status as animal_status
       from v_lactation_summary s join animals a on a.id = s.animal_id`,
    ),
    loadLifetimeYield(pg),
    loadTests(pg),
  ])
  const out = rows.map((r) => ({
    ...r,
    // date-Spalten kommen aus pglite als Date
    calving_date: (r.calving_date as unknown) instanceof Date ? sqlDate(r.calving_date) : r.calving_date,
    milk_kg: num(r.milk_kg),
    fat_kg: num(r.fat_kg),
    fat_pct: num(r.fat_pct),
    protein_kg: num(r.protein_kg),
    protein_pct: num(r.protein_pct),
    fat_protein_kg: num(r.fat_protein_kg),
    days_in_milk: num(r.days_in_milk),
  }))
  return { rows: out, ltl, tests }
}

const n0 = (v: number | null) => (v == null ? '–' : Math.round(v).toLocaleString('de-CH'))
const n2 = (v: number | null) => (v == null ? '–' : v.toFixed(2))

interface Settings {
  view: 'tier' | 'alle'
  metric: CurveMetric
  /** Erste Wägungen je Laktation, die nicht zählen (Säugezeit). */
  skipFirst: 0 | 1 | 2
  filter: LactationFilter
  animalSort: AnimalSort
  rowSort: RowSort
  rowDesc: boolean
}

const DEFAULT_SETTINGS: Settings = { view: 'tier', metric: 'fe', skipFirst: 1, filter: DEFAULT_FILTER, animalSort: 'lauf_nr', rowSort: 'fat_protein_kg', rowDesc: true }

function loadSettings(key: string): Settings {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return DEFAULT_SETTINGS
    const s = JSON.parse(raw) as Partial<Settings>
    // Suche nicht über Besuche hinweg merken.
    return { ...DEFAULT_SETTINGS, ...s, filter: { ...DEFAULT_FILTER, ...s.filter, search: '' } }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function StatusBadge({ closure }: { closure: number }) {
  const running = closure >= 7
  return (
    <span
      title={CLOSURE_LABEL[closure] ?? String(closure)}
      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${running ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
    >
      {CLOSURE_SHORT[closure] ?? closure}
    </span>
  )
}

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)} %`)
const pp = (v: number | null | undefined) => (v == null ? '–' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`)

const QUARTILE_STYLE: Record<number, string> = {
  4: 'bg-green-100 text-green-800',
  3: 'bg-green-50 text-green-700',
  2: 'bg-amber-50 text-amber-800',
  1: 'bg-red-100 text-red-800',
}
const QUARTILE_TITLE: Record<number, string> = {
  4: 'oberstes Viertel der Herde',
  3: 'zweitbestes Viertel',
  2: 'zweitschwächstes Viertel',
  1: 'unterstes Viertel der Herde',
}

function QuartileChip({ q }: { q: number | null | undefined }) {
  if (q == null) return null
  return (
    <span title={QUARTILE_TITLE[q]} className={`rounded px-1.5 py-0.5 text-xs font-semibold ${QUARTILE_STYLE[q]}`}>
      Q{q}
    </span>
  )
}

function ClassChip({ klass }: { klass: CurveClass | null | undefined }) {
  if (!klass) return null
  return (
    <span className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: CLASS_COLOR[klass] }}>
      {CURVE_CLASS_LABEL[klass]}
    </span>
  )
}

/** Niveau je Laktation (älteste links) im Herdenvergleich — fair über die
 * Jahre, zeigt die Tendenz auf einen Blick. Linie = 100 % (wie die Herde);
 * laufende Laktation heller, ohne Bewertung nur ein Strich. */
function LevelBars({ animal }: { animal: AnimalLactations }) {
  const ordered = [...animal.lactations].reverse()
  const H = 40
  const MAX = 1.6
  return (
    <div className="relative flex h-10 items-end gap-0.5" aria-hidden>
      <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-gray-400" style={{ bottom: `${(1 / MAX) * H}px` }} />
      {ordered.map((l) => {
        const h = l.level != null ? Math.max(3, Math.min(MAX, l.level) / MAX * H) : 2
        return (
          <div
            key={l.lactation_id}
            title={`${l.lactation_number}. Laktation: ${l.level != null ? `${Math.round(l.level * 100)} % der Herde` : 'keine Bewertung'} · ${n0(l.fat_protein_kg)} kg F+E (${CLOSURE_LABEL[l.closure_type] ?? ''})`}
            className={`w-2.5 rounded-sm ${l.level == null ? 'bg-gray-200' : l.level >= 1 ? 'bg-teal-600' : 'bg-slate-400'} ${isRunning(l) ? 'opacity-50' : ''}`}
            style={{ height: `${h}px` }}
          />
        )
      })}
    </div>
  )
}

function LactationTable({ rows, showAnimal, calvingLabel, sort }: {
  rows: LactationRow[]
  showAnimal: boolean
  calvingLabel: string
  sort?: { key: RowSort; desc: boolean; onSort: (k: RowSort) => void }
}) {
  const head = (key: RowSort, label: string, right = true) => (
    <th
      onClick={sort ? () => sort.onSort(key) : undefined}
      className={`whitespace-nowrap px-2 py-1.5 font-medium ${right ? 'text-right' : 'text-left'} ${sort ? 'cursor-pointer select-none' : ''} ${
        sort?.key === key ? 'text-brand-700' : ''
      }`}
    >
      {label}
      {sort?.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
    </th>
  )
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="border-b text-xs text-gray-500">
          {showAnimal && head('label', 'Tier', false)}
          {head('lactation_number', 'Lakt.')}
          {head('calving_date', calvingLabel, false)}
          <th className="px-2 py-1.5 text-left font-medium">Status</th>
          {head('days_in_milk', 'Tage')}
          {head('milk_kg', 'Milch kg')}
          {head('fat_kg', 'Fett kg / %')}
          {head('protein_kg', 'Eiweiss kg / %')}
          {head('fat_protein_kg', 'F+E kg')}
          {head('fe_per_day', 'F+E g/Tag')}
          {head('level', 'Niveau')}
          {head('persistence', 'Persistenz')}
          <th className="px-2 py-1.5 text-left font-medium">Kurve</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.lactation_id} className={`border-b last:border-0 ${isRunning(l) ? 'bg-green-50/50' : ''}`}>
            {showAnimal && (
              <td className="whitespace-nowrap px-2 py-1.5 font-medium text-gray-800">
                <Link to={`kuehe/${l.animal_id}`} className="hover:text-brand-700">
                  {l.lauf_nr && <span className="mr-1 rounded bg-gray-100 px-1 text-xs font-bold">{l.lauf_nr}</span>}
                  {animalLabel(l)}
                </Link>
              </td>
            )}
            <td className="px-2 py-1.5 text-right text-gray-600">{l.lactation_number}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{fmtDate(l.calving_date)}</td>
            <td className="px-2 py-1.5">
              <StatusBadge closure={l.closure_type} />
            </td>
            <td className="px-2 py-1.5 text-right text-gray-600">{l.days_in_milk ?? '–'}</td>
            <td className="px-2 py-1.5 text-right text-gray-700">{n0(l.milk_kg)}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right text-gray-700">
              {n0(l.fat_kg)} <span className="text-xs text-gray-400">{n2(l.fat_pct)}</span>
            </td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right text-gray-700">
              {n0(l.protein_kg)} <span className="text-xs text-gray-400">{n2(l.protein_pct)}</span>
            </td>
            <td className="px-2 py-1.5 text-right font-semibold text-gray-900">{n0(l.fat_protein_kg)}</td>
            <td className="px-2 py-1.5 text-right text-gray-600">{n0(fePerDay(l))}</td>
            <td className="whitespace-nowrap px-2 py-1.5 text-right text-gray-700">
              {pct(l.level)} <QuartileChip q={l.quartile} />
            </td>
            <td className="px-2 py-1.5 text-right text-gray-700">{pp(l.persistence)}</td>
            <td className="px-2 py-1.5">
              <ClassChip klass={l.klass} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Laktationsleistung: pro Tier (Säulen + aufklappbare Tabelle) oder alle
 * Laktationen als sortierbare Tabelle, mit Suche und Filtern. Einstellungen
 * bleiben pro Gerät und Herde gespeichert. */
export default function LactationView({ moduleKey }: { moduleKey: string }) {
  const terms = speciesTerms(moduleKey)
  const calvingLabel = speciesOf(moduleKey) === 'sheep' ? 'Ablammung' : 'Abkalbung'
  const storageKey = `${moduleKey}_lactation_view`
  const { data, loading } = useQuery(loadLactations)
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings(storageKey))
  const [open, setOpen] = useState<Set<string>>(new Set())
  const { view, metric, skipFirst, filter, animalSort, rowSort, rowDesc } = settings

  function setSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch }
    setSettingsState(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // nur bis zum Reload
    }
  }
  const setFilter = (patch: Partial<LactationFilter>) => setSettings({ filter: { ...filter, ...patch } })

  // Kurven im Herdenvergleich (lib/lactationCurves.ts)
  const curveData = useMemo(() => {
    const tests = data?.tests ?? []
    const ref = buildHerdReference(tests, metric)
    const model = buildTestDayModel(tests, metric)
    const curves = analyzeLactations(tests, model, skipFirst)
    const bounds = quartileBounds([...curves.values()].map((c) => c.level).filter((v): v is number => v != null))
    // Typische Melkdauer abgeschlossener Laktationen je Gruppe — für die
    // Hochrechnung laufender (Niveau × Herdenkurve des Jahrgangs über diese Dauer).
    const days = { 1: [] as number[], 2: [] as number[] }
    for (const r of data?.rows ?? []) if (!isRunning(r) && r.days_in_milk) days[parityGroup(r.lactation_number)].push(r.days_in_milk)
    const typicalDays = {
      1: Math.round(quantile([...days[1]].sort((a, b) => a - b), 0.5)) || 220,
      2: Math.round(quantile([...days[2]].sort((a, b) => a - b), 0.5)) || 220,
    }
    const running = new Set((data?.rows ?? []).filter(isRunning).map((r) => curveKey(r.animal_id, r.lactation_number)))
    const trends = trendsByAnimal(curves.values(), (id, nr) => running.has(curveKey(id, nr)))
    return { ref, model, curves, bounds, typicalDays, trends }
  }, [data, metric, skipFirst])

  const all = useMemo(
    () =>
      (data?.rows ?? []).map((r) => {
        const c = curveData.curves.get(curveKey(r.animal_id, r.lactation_number))
        return {
          ...r,
          level: c?.level ?? null,
          persistence: c?.persistence ?? null,
          quartile: quartileOf(c?.level ?? null, curveData.bounds),
          klass: curveClass(c),
          lastDim: c?.lastDim ?? null,
        }
      }),
    [data, curveData],
  )
  const years = useMemo(() => calvingYears(all), [all])
  const rows = useMemo(
    () =>
      all.filter(
        (l) =>
          matchesLactation(l, filter) &&
          (view === 'tier' || matchesCurve(l, filter.curve)) &&
          (filter.curve !== 'fallend' || curveData.trends.get(l.animal_id)?.direction === 'fallend'),
      ),
    [all, filter, view, curveData],
  )
  const animals = useMemo(
    () =>
      sortAnimals(
        groupByAnimal(rows)
          .map((a) => ({ ...a, ltl: data?.ltl.get(a.animal_id), trend: curveData.trends.get(a.animal_id) }))
          .filter((a) => matchesCurve(a.rated, filter.curve)),
        animalSort,
      ),
    [rows, animalSort, data, filter.curve, curveData],
  )
  const sortedRows = useMemo(() => sortRows(rows, rowSort, rowDesc), [rows, rowSort, rowDesc])
  const scatter = useMemo<ScatterPoint[]>(
    () =>
      animals
        .filter((a) => a.rated?.level != null && a.rated.persistence != null && a.rated.klass)
        .map((a) => ({
          animal_id: a.animal_id,
          label: `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${a.label}`,
          lactation_number: a.rated!.lactation_number,
          running: isRunning(a.rated!),
          level: a.rated!.level!,
          persistence: a.rated!.persistence!,
          klass: a.rated!.klass!,
        })),
    [animals],
  )
  // Herdenbild Milch × Laktationstag (lib/herdSnapshot.ts): eigener
  // Wägungstag und eigene Grösse (Standard Milch kg)
  const [dimDate, setDimDate] = useState<string | null>(null)
  const [dimMetric, setDimMetric] = useState<CurveMetric>('milk')
  const days = useMemo(() => weighingDays(data?.tests ?? []), [data])
  const snapshotDate = dimDate ?? days[0]?.date ?? null
  const dimRef = useMemo(() => (dimMetric === metric ? curveData.ref : buildHerdReference(data?.tests ?? [], dimMetric)), [data, dimMetric, metric, curveData])
  const dimPoints = useMemo<DimPoint[]>(() => {
    if (!snapshotDate) return []
    const shown = new Map(animals.map((a) => [a.animal_id, `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${a.label}`]))
    return herdSnapshot(data?.tests ?? [], snapshotDate, dimMetric, dimRef)
      .filter((p) => shown.has(p.animal_id))
      .map((p) => ({ ...p, label: shown.get(p.animal_id)! }))
  }, [data, snapshotDate, dimMetric, dimRef, animals])
  const dimCounts = useMemo(() => {
    const c = { hoch: 0, mitte: 0, tief: 0 }
    for (const p of dimPoints) if (p.position) c[p.position]++
    return c
  }, [dimPoints])
  const classCounts = useMemo(() => {
    const m = new Map<CurveClass, number>()
    for (const p of scatter) m.set(p.klass, (m.get(p.klass) ?? 0) + 1)
    return m
  }, [scatter])

  function selectAnimal(id: string) {
    setOpen((o) => new Set(o).add(id))
    if (view !== 'tier') setSettings({ view: 'tier' })
    setTimeout(() => document.getElementById(`lact-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  if (loading && !data) return <p className="text-center text-gray-400">Lädt…</p>
  if (data && all.length === 0) return <p className="text-center text-gray-500">Keine Laktationsdaten. {terms.importHint}</p>

  const select = 'rounded border border-gray-300 bg-white px-2 py-1.5 text-sm'
  const filtered = filter.search || filter.status !== 'alle' || filter.parity !== 'alle' || filter.year || !filter.activeOnly || filter.curve
  const metricUnit = metric === 'fe' ? 'kg F+E' : 'kg Milch'

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Suche: Laufnummer, Name, Ohrmarke"
            value={filter.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
          <div className="flex rounded border border-gray-300 text-xs">
            {(
              [
                ['tier', `Pro ${terms.singular}`],
                ['alle', 'Alle Laktationen'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setSettings({ view: v })}
                className={`px-2.5 py-1.5 ${view === v ? 'bg-brand-700 text-white' : 'text-gray-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={select} value={filter.status} onChange={(e) => setFilter({ status: e.target.value as LactationFilter['status'] })}>
            <option value="alle">Alle Status</option>
            <option value="laufend">Nur laufende</option>
            <option value="abgeschlossen">Nur abgeschlossene</option>
          </select>
          <select className={select} value={filter.parity} onChange={(e) => setFilter({ parity: e.target.value as LactationFilter['parity'] })}>
            <option value="alle">Alle Laktationen</option>
            <option value="1">1. Laktation</option>
            <option value="2">2. Laktation</option>
            <option value="3+">ab 3. Laktation</option>
          </select>
          <select className={select} value={filter.year} onChange={(e) => setFilter({ year: e.target.value })}>
            <option value="">{calvingLabel}: alle Jahre</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {calvingLabel} {y}
              </option>
            ))}
          </select>
          {view === 'tier' && (
            <select className={select} value={animalSort} onChange={(e) => setSettings({ animalSort: e.target.value as AnimalSort })}>
              {Object.entries(ANIMAL_SORT_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  Sortieren: {label}
                </option>
              ))}
            </select>
          )}
          <select className={select} value={filter.curve} onChange={(e) => setFilter({ curve: e.target.value as LactationFilter['curve'] })}>
            <option value="">Alle Kurven</option>
            <option value="q4">oberstes Viertel (Q4)</option>
            <option value="q1">unterstes Viertel (Q1)</option>
            <option value="fallend">Tendenz fallend</option>
            {(Object.keys(CURVE_CLASS_LABEL) as CurveClass[]).map((k) => (
              <option key={k} value={k}>
                {CURVE_CLASS_LABEL[k]}
              </option>
            ))}
          </select>
          <div className="flex rounded border border-gray-300 text-xs" title="Grundlage für Kurven, Niveau und Persistenz">
            {(
              [
                ['fe', 'Kurven: F+E'],
                ['milk', 'Milch'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setSettings({ metric: v })}
                className={`px-2.5 py-1.5 ${metric === v ? 'bg-brand-700 text-white' : 'text-gray-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            className={select}
            value={skipFirst}
            onChange={(e) => setSettings({ skipFirst: Number(e.target.value) as Settings['skipFirst'] })}
            title="Um Tag 30 saugen oft noch die Lämmer — diese Wägungen zählen nicht für Niveau und Persistenz (bleiben in der Kurve sichtbar, hohl)"
          >
            <option value={0}>Alle Wägungen zählen</option>
            <option value={1}>Erste Wägung weglassen</option>
            <option value={2}>Erste zwei weglassen</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={filter.activeOnly} onChange={(e) => setFilter({ activeOnly: e.target.checked })} />
            nur aktive {terms.plural}
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            {animals.length} {animals.length === 1 ? terms.singular : terms.plural} · {rows.length} Laktationen
            {filtered && (
              <button type="button" onClick={() => setSettings({ filter: DEFAULT_FILTER })} className="ml-2 text-brand-700 underline">
                Filter zurücksetzen
              </button>
            )}
          </span>
          {view === 'tier' && animals.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen(open.size ? new Set() : new Set(animals.map((a) => a.animal_id)))}
              className="text-brand-700"
            >
              {open.size ? 'Alle zuklappen' : 'Alle aufklappen'}
            </button>
          )}
        </div>
      </div>

      {scatter.length > 0 && (
        <details className="rounded-lg bg-white shadow-sm">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm">
            <span className="font-semibold text-gray-700">Herdenbild: Niveau × Persistenz</span>
            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
              {(Object.keys(CURVE_CLASS_LABEL) as CurveClass[]).map((k) => (
                <span key={k} className="rounded px-1.5 py-0.5 text-xs text-white" style={{ background: CLASS_COLOR[k] }}>
                  {classCounts.get(k) ?? 0} {CURVE_CLASS_LABEL[k]}
                </span>
              ))}
            </span>
          </summary>
          <div className="border-t px-2 pb-2">
            <HerdScatter points={scatter} onSelect={selectAnimal} />
            <p className="px-1 text-xs text-gray-500">
              Je {terms.singular} ein Punkt: die neueste bewertete Laktation (laufende ab 2 Wägungen). Jede Wägung wird mit den
              Herdengenossinnen <b>am gleichen Wägungstag</b> verglichen und um Laktationstag und Alter bereinigt (Erstlinge getrennt) —
              Jahr, Saison und Futter fallen so heraus. <b>Niveau</b> = diese Vergleiche im Mittel (100 % = wie die Herde).{' '}
              <b>Persistenz</b> = wie sich der Vergleich je 100 Tage verändert: 0 = Kurve verläuft wie die Herde, negativ = fällt nach dem
              Höhepunkt stärker ab. Viertel (Q1–Q4) nach Niveau über alle Laktationen. Grundlage: {metricUnit}
              {skipFirst ? `, ohne die ${skipFirst === 1 ? 'erste Wägung' : 'ersten zwei Wägungen'} jeder Laktation (Säugezeit)` : ''}. Antippen öffnet
              das Tier.
            </p>
          </div>
        </details>
      )}

      {days.length > 0 && (
        <details className="rounded-lg bg-white shadow-sm">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm">
            <span className="font-semibold text-gray-700">Herdenbild: {dimMetric === 'fe' ? 'F+E' : 'Milch'} × Laktationstag</span>
            {snapshotDate && <span className="ml-2 text-xs text-gray-500">Wägung {fmtDate(snapshotDate)}</span>}
            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
              {(['hoch', 'mitte', 'tief'] as const).map((k) => (
                <span key={k} className="rounded px-1.5 py-0.5 text-xs text-white" style={{ background: POSITION_COLOR[k] }}>
                  {dimCounts[k]} {k === 'hoch' ? 'über' : k === 'tief' ? 'unter' : 'mittel'}
                </span>
              ))}
            </span>
          </summary>
          <div className="space-y-1 border-t px-2 pb-2 pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <select className="rounded border border-gray-300 bg-white px-2 py-1" value={snapshotDate ?? ''} onChange={(e) => setDimDate(e.target.value)}>
                {days.map((d) => (
                  <option key={d.date} value={d.date}>
                    Wägung {fmtDate(d.date)} ({d.n})
                  </option>
                ))}
              </select>
              {(
                [
                  ['milk', 'kg Milch'],
                  ['fe', 'kg F+E'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDimMetric(m)}
                  className={`rounded px-2 py-0.5 ${dimMetric === m ? 'bg-brand-700 text-white' : 'border border-gray-300 text-gray-600'}`}
                >
                  {label}
                </button>
              ))}
              {dimPoints.length > 0 && (
                <span className="text-gray-500">
                  {dimPoints.length} {terms.plural} · ⌀ Tag {Math.round(dimPoints.reduce((s, p) => s + p.dim, 0) / dimPoints.length)} · ⌀{' '}
                  {(dimPoints.reduce((s, p) => s + p.value, 0) / dimPoints.length).toFixed(dimMetric === 'fe' ? 2 : 1)} kg
                </span>
              )}
            </div>
            {snapshotDate && snapshotDate === days[0]?.date && (
              <p className="text-xs text-gray-400">Neueste Wägung; frühere im Auswahlfeld.</p>
            )}
            <HerdDimChart
              points={dimPoints}
              bandOlder={bandFor(dimRef, snapshotDate, 2)}
              bandFirst={bandFor(dimRef, snapshotDate, 1)}
              unitLabel={dimMetric === 'fe' ? 'kg F+E' : 'kg Milch'}
              decimals={dimMetric === 'fe' ? 2 : 1}
              onSelect={selectAnimal}
            />
            <p className="px-1 text-xs text-gray-500">
              Je {terms.singular} ein Punkt: Wägung am gewählten Tag, an ihrem Laktationstag. Grau die mittlere Hälfte der Herde ab 2.
              Laktation mit Median, gestrichelt der Median der Erstlinge (Jahrgang der Wägung). <b>Grün</b> über, <b>rot</b> unter der
              mittleren Hälfte der eigenen Gruppe, hohl = Erstling. Es gelten die Filter oben. Antippen öffnet das Tier.
            </p>
          </div>
        </details>
      )}

      {rows.length === 0 && <p className="text-center text-sm text-gray-500">Keine Laktationen für diese Filter.</p>}

      {view === 'tier' && (
        <ul className="space-y-2">
          {animals.map((a) => {
            const isOpen = open.has(a.animal_id)
            const rated = a.rated
            const ratedCurve = rated ? curveData.curves.get(curveKey(a.animal_id, rated.lactation_number)) : undefined
            const band = ratedCurve ? bandFor(curveData.ref, ratedCurve.calving_date, ratedCurve.group) : []
            const herdTotal = ratedCurve ? expectedTotal(band, curveData.typicalDays[ratedCurve.group]) : null
            const projection = rated && isRunning(rated) && rated.level != null && herdTotal != null ? rated.level * herdTotal : null
            const animalCurves = a.lactations
              .map((l) => curveData.curves.get(curveKey(a.animal_id, l.lactation_number)))
              .filter((c): c is NonNullable<typeof c> => !!c && c.points.length > 0)
            return (
              <li key={a.animal_id} id={`lact-${a.animal_id}`} className="scroll-mt-20 rounded-lg bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(open)
                    if (isOpen) next.delete(a.animal_id)
                    else next.add(a.animal_id)
                    setOpen(next)
                  }}
                  className="flex w-full items-center gap-3 p-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-800">
                      {a.lauf_nr && <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-sm font-bold">{a.lauf_nr}</span>}
                      {a.label}
                      {a.animal_status !== 'aktiv' && <span className="ml-1.5 text-xs font-normal text-gray-400">{a.animal_status}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                      <span>
                        {a.lactations.length} {a.lactations.length === 1 ? 'Laktation' : 'Laktationen'}
                      </span>
                      <span>
                        letzte: <span className="font-semibold text-gray-800">{n0(a.latest.fat_protein_kg)} kg F+E</span>{' '}
                        <StatusBadge closure={a.latest.closure_type} />
                      </span>
                      {a.avgFe != null && <span>Ø {n0(a.avgFe)} kg F+E</span>}
                      <span>total {n0(a.totalMilk)} kg Milch</span>
                      {a.ltl?.fe != null && (
                        <span title="Lebenstagleistung: Milch bzw. F+E aller Laktationen je Lebenstag; % = im Vergleich zu Herdengenossinnen mit gleich vielen Laktationen">
                          LTL {a.ltl.milk?.toFixed(2) ?? '–'} kg Milch · {n0(a.ltl.fe * 1000)} g F+E/Tag
                          {a.ltl.feRel != null && (
                            <span className={`ml-1 font-semibold ${a.ltl.feRel >= 1.1 ? 'text-green-700' : a.ltl.feRel < 0.9 ? 'text-red-700' : 'text-gray-700'}`}>
                              {Math.round(a.ltl.feRel * 100)} %
                            </span>
                          )}
                          {a.ltl.feRel == null && <span className="ml-1 text-gray-400">(1. Laktation läuft, noch kein Vergleich)</span>}
                        </span>
                      )}
                    </div>
                    {(a.trend?.direction || a.trend?.running) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
                        <TrendBadge trend={a.trend} />
                        {a.trend?.running && a.trend.running.ownMean != null && (
                          <span title="Niveau der laufenden Laktation im Vergleich zum Mittel ihrer früheren Laktationen (beides in % der Herde)">
                            laufende {Math.round(a.trend.running.level * 100)} % · eigenes Mittel {Math.round(a.trend.running.ownMean * 100)} %{' '}
                            <b
                              className={
                                a.trend.running.level - a.trend.running.ownMean <= -0.1
                                  ? 'text-red-700'
                                  : a.trend.running.level - a.trend.running.ownMean >= 0.1
                                    ? 'text-green-700'
                                    : 'text-gray-700'
                              }
                            >
                              {a.trend.running.level >= a.trend.running.ownMean ? '+' : ''}
                              {Math.round((a.trend.running.level - a.trend.running.ownMean) * 100)}
                            </b>
                            {a.trend.running.tests < 3 ? ' (vorläufig)' : ''}
                          </span>
                        )}
                      </div>
                    )}
                    {rated && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
                        <QuartileChip q={rated.quartile} />
                        <ClassChip klass={rated.klass} />
                        <span>
                          Niveau <b>{pct(rated.level)}</b>
                          {rated.persistence != null && (
                            <>
                              {' '}
                              · Persistenz <b>{pp(rated.persistence)}</b>
                            </>
                          )}
                        </span>
                        <span className="text-gray-400">
                          {rated.lactation_number}. Lakt.{isRunning(rated) ? `, laufend, Tag ${rated.lastDim ?? '?'}` : ''}
                        </span>
                        {projection != null && Number.isFinite(projection) && (
                          <span
                            title={`Wenn die Kurve weiter wie die Herde verläuft: Niveau × Herdenkurve des Jahrgangs über ${
                              curveData.typicalDays[ratedCurve!.group]
                            } Melktage (übliche Dauer)`}
                          >
                            Hochrechnung ≈ {n0(projection)} {metricUnit} (Herde {n0(herdTotal)})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {ratedCurve && (
                    <MiniCurve curve={ratedCurve} band={curveData.model.relBand[ratedCurve.group]} color={rated?.klass ? CLASS_COLOR[rated.klass] : undefined} />
                  )}
                  <span className="hidden sm:block">
                    <LevelBars animal={a} />
                  </span>
                  <span className="text-gray-300">{isOpen ? '▴' : '▾'}</span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto border-t px-1 pb-2">
                    {animalCurves.length > 0 && (
                      <LactationCurveChart
                        curves={animalCurves}
                        band={bandFor(curveData.ref, a.latest.calving_date, parityGroup(a.latest.lactation_number))}
                        relBand={curveData.model.relBand[parityGroup(a.latest.lactation_number)]}
                        year={a.latest.calving_date?.slice(0, 4) ?? null}
                        group={parityGroup(a.latest.lactation_number)}
                        metric={metric}
                        runningNumber={isRunning(a.latest) ? a.latest.lactation_number : null}
                      />
                    )}
                    <LactationTable rows={a.lactations} showAnimal={false} calvingLabel={calvingLabel} />
                    <Link to={`kuehe/${a.animal_id}`} className="ml-2 text-xs text-brand-700">
                      Zum Tier →
                    </Link>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {view === 'alle' && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <LactationTable
            rows={sortedRows}
            showAnimal
            calvingLabel={calvingLabel}
            sort={{
              key: rowSort,
              desc: rowDesc,
              onSort: (k) => setSettings(k === rowSort ? { rowDesc: !rowDesc } : { rowSort: k, rowDesc: k !== 'label' }),
            }}
          />
        </div>
      )}
    </div>
  )
}
