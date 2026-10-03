import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, num } from '../lib/format'
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
  matchesLactation,
  sortAnimals,
  sortRows,
  type AnimalLactations,
  type AnimalSort,
  type LactationFilter,
  type LactationRow,
  type RowSort,
} from '../lib/lactationView'
import { animalLabel } from '@fmis/core/earTag'

async function loadLactations(pg: PGlite): Promise<LactationRow[]> {
  const { rows } = await pg.query<LactationRow>(
    `select s.*, a.lauf_nr, a.status as animal_status
     from v_lactation_summary s join animals a on a.id = s.animal_id`,
  )
  return rows.map((r) => ({
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
}

const n0 = (v: number | null) => (v == null ? '–' : Math.round(v).toLocaleString('de-CH'))
const n2 = (v: number | null) => (v == null ? '–' : v.toFixed(2))

interface Settings {
  view: 'tier' | 'alle'
  filter: LactationFilter
  animalSort: AnimalSort
  rowSort: RowSort
  rowDesc: boolean
}

const DEFAULT_SETTINGS: Settings = { view: 'tier', filter: DEFAULT_FILTER, animalSort: 'lauf_nr', rowSort: 'fat_protein_kg', rowDesc: true }

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

/** F+E je Laktation als kleine Säulen (älteste links), gemeinsamer Massstab
 * über alle angezeigten Tiere; laufende Laktation heller. */
function FeBars({ animal, scale }: { animal: AnimalLactations; scale: number }) {
  const ordered = [...animal.lactations].reverse()
  return (
    <div className="flex h-10 items-end gap-0.5" aria-hidden>
      {ordered.map((l) => {
        const h = l.fat_protein_kg != null && scale > 0 ? Math.max(2, (l.fat_protein_kg / scale) * 40) : 2
        return (
          <div
            key={l.lactation_id}
            title={`${l.lactation_number}. Laktation: ${n0(l.fat_protein_kg)} kg F+E (${CLOSURE_LABEL[l.closure_type] ?? ''})`}
            className={`w-2.5 rounded-sm ${isRunning(l) ? 'bg-brand-300' : 'bg-brand-600'}`}
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
  const { view, filter, animalSort, rowSort, rowDesc } = settings

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

  const all = data ?? []
  const years = useMemo(() => calvingYears(all), [all])
  const rows = useMemo(() => all.filter((l) => matchesLactation(l, filter)), [all, filter])
  const animals = useMemo(() => sortAnimals(groupByAnimal(rows), animalSort), [rows, animalSort])
  const sortedRows = useMemo(() => sortRows(rows, rowSort, rowDesc), [rows, rowSort, rowDesc])
  const scale = useMemo(() => Math.max(0, ...rows.map((r) => r.fat_protein_kg ?? 0)), [rows])

  if (loading && !data) return <p className="text-center text-gray-400">Lädt…</p>
  if (data && all.length === 0) return <p className="text-center text-gray-500">Keine Laktationsdaten. {terms.importHint}</p>

  const select = 'rounded border border-gray-300 bg-white px-2 py-1.5 text-sm'
  const filtered = filter.search || filter.status !== 'alle' || filter.parity !== 'alle' || filter.year || !filter.activeOnly

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

      {rows.length === 0 && <p className="text-center text-sm text-gray-500">Keine Laktationen für diese Filter.</p>}

      {view === 'tier' && (
        <ul className="space-y-2">
          {animals.map((a) => {
            const isOpen = open.has(a.animal_id)
            return (
              <li key={a.animal_id} className="rounded-lg bg-white shadow-sm">
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
                    </div>
                  </div>
                  <FeBars animal={a} scale={scale} />
                  <span className="text-gray-300">{isOpen ? '▴' : '▾'}</span>
                </button>
                {isOpen && (
                  <div className="overflow-x-auto border-t px-1 pb-2">
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
