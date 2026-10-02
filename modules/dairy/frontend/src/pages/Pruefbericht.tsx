import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { animalLabel } from '@fmis/core/earTag'
import { useQuery } from '../hooks/useQuery'
import { loadTestReportData } from '../lib/testReportData'
import { buildReport, summarize, testDates, type ReportRow, type ReportSummary } from '../lib/testReport'
import { speciesOf, speciesTerms } from '../lib/species'
import { useCullingThresholds } from '../lib/cullingSettings'
import PaperReport, { PAPER_CSS, ddmmyyyy } from '../components/PaperReport'

type Align = 'left' | 'right'

interface Column {
  key: string
  label: string
  group: string
  /** Zusatzkennzahl, die es auf dem Papier nicht gibt — farbig hervorgehoben. */
  highlight?: boolean
  align?: Align
  value: (r: ReportRow) => number | string | null
  format?: (v: number) => string
  avg?: (s: ReportSummary) => number | null
  /** Zelle als auffällig markieren (z.B. Zellzahl ≥ 150'000). */
  warn?: (r: ReportRow) => boolean
}

const f = (d: number) => (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d })

/** `sccLimit` in 1000/ml; `ecm` nur bei Kühen — die ECM-Formel gilt für
 * Kuhmilch, Schafmilch hat andere Gehalte. */
function columnsFor(calvingWord: string, sccLimit: number, withEcm: boolean): Column[] {
  const cols: Column[] = [
    { key: 'lakt', label: 'Lakt.', group: 'Tier', value: (r) => r.test.lactation_number, format: f(0), avg: (s) => s.lactation },
    { key: 'dim', label: 'Tage', group: 'Tier', value: (r) => r.dim, format: f(0), avg: (s) => s.dim },
    { key: 'calving', label: calvingWord, group: 'Tier', value: (r) => r.test.calving_date && ddmmyyyy(r.test.calving_date) },
    { key: 'service', label: 'Deckdatum', group: 'Tier', value: (r) => r.lastService && ddmmyyyy(r.lastService) },
    { key: 'morning', label: 'Morgen kg', group: 'Probe', value: (r) => r.test.milk_morning_kg, format: f(1) },
    { key: 'evening', label: 'Abend kg', group: 'Probe', value: (r) => r.test.milk_evening_kg, format: f(1) },
    { key: 'milk', label: 'Milch kg', group: 'Probe', value: (r) => r.test.milk_kg, format: f(1), avg: (s) => s.milk },
    { key: 'pers', label: 'Pers. %', group: 'Probe', value: (r) => r.test.sample_persistency, format: f(0), avg: (s) => s.persistency },
    { key: 'fat', label: 'Fett %', group: 'Probe', value: (r) => r.test.fat_pct, format: f(2), avg: (s) => s.fat_pct },
    { key: 'protein', label: 'Eiweiss %', group: 'Probe', value: (r) => r.test.protein_pct, format: f(2), avg: (s) => s.protein_pct },
    { key: 'lactose', label: 'Laktose %', group: 'Probe', value: (r) => r.test.lactose_pct, format: f(2), avg: (s) => s.lactose_pct },
    { key: 'feq', label: 'FEQ', group: 'Probe', value: (r) => r.feq, format: f(2), avg: (s) => s.feq, warn: (r) => r.feq != null && r.feq > 1.4 },
    {
      key: 'urea',
      label: 'Harnstoff',
      group: 'Probe',
      value: (r) => r.test.urea_mg_dl,
      format: f(0),
      avg: (s) => s.urea,
      warn: (r) => r.test.urea_mg_dl != null && (r.test.urea_mg_dl < 15 || r.test.urea_mg_dl > 27),
    },
    {
      key: 'scc',
      label: 'Zellzahl',
      group: 'Probe',
      value: (r) => r.test.cell_count,
      format: f(0),
      avg: (s) => s.scc,
      warn: (r) => r.test.cell_count != null && r.test.cell_count >= sccLimit,
    },
    { key: 'sccPrev', label: 'ZZ Vorprobe', group: 'Probe', value: (r) => r.sccPrevious, format: f(0) },
    { key: 'bhb', label: 'BHB mmol/l', group: 'Probe', value: (r) => r.test.bhb_mmol, format: f(2) },
    { key: 'acetone', label: 'Aceton mmol/l', group: 'Probe', value: (r) => r.test.acetone_mmol, format: f(2) },
    { key: 'fatKg', label: 'Fett kg', group: 'Kennzahlen', highlight: true, value: (r) => r.fatKg, format: f(2), avg: (s) => s.fatKg },
    { key: 'proteinKg', label: 'Eiweiss kg', group: 'Kennzahlen', highlight: true, value: (r) => r.proteinKg, format: f(2), avg: (s) => s.proteinKg },
    { key: 'fpKg', label: 'F+E kg', group: 'Kennzahlen', highlight: true, value: (r) => r.fatProteinKg, format: f(2), avg: (s) => s.fatProteinKg },
    { key: 'ecm', label: 'ECM kg', group: 'Kennzahlen', highlight: true, value: (r) => r.ecmKg, format: f(1), avg: (s) => s.ecmKg },
    { key: 'curDays', label: 'Lakt. Tage', group: 'Laufende Laktation', value: (r) => r.current?.days ?? null, format: f(0) },
    { key: 'curMilk', label: 'Lakt. Milch', group: 'Laufende Laktation', value: (r) => r.current?.milk ?? null, format: f(0) },
    { key: 'curFat', label: 'Lakt. Fett %', group: 'Laufende Laktation', value: (r) => r.current?.fat_pct ?? null, format: f(2) },
    { key: 'curProtein', label: 'Lakt. Eiweiss %', group: 'Laufende Laktation', value: (r) => r.current?.protein_pct ?? null, format: f(2) },
    { key: 'curScc', label: 'Lakt. ZZ', group: 'Laufende Laktation', value: (r) => r.current?.scc ?? null, format: f(0) },
    { key: 'stdDays', label: 'Std. Tage', group: 'Standardlaktation', value: (r) => r.standard?.days ?? null, format: f(0) },
    { key: 'stdMilk', label: 'Std. Milch', group: 'Standardlaktation', value: (r) => r.standard?.milk ?? null, format: f(0), avg: (s) => s.stdMilk },
    { key: 'stdFat', label: 'Std. Fett %', group: 'Standardlaktation', value: (r) => r.standard?.fat_pct ?? null, format: f(2), avg: (s) => s.stdFat },
    { key: 'stdProtein', label: 'Std. Eiweiss %', group: 'Standardlaktation', value: (r) => r.standard?.protein_pct ?? null, format: f(2), avg: (s) => s.stdProtein },
    {
      key: 'lactPers',
      label: 'Lakt. Pers. %',
      group: 'Standardlaktation',
      value: (r) => r.current?.persistency ?? r.standard?.persistency ?? null,
      format: f(0),
    },
  ]
  return withEcm ? cols : cols.filter((c) => c.key !== 'ecm')
}

const DEFAULT_COLUMNS = ['lakt', 'dim', 'milk', 'fat', 'protein', 'fatKg', 'proteinKg', 'fpKg', 'ecm', 'urea', 'scc', 'sccPrev']

function loadColumns(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // localStorage nicht verfügbar → Vorgabe
  }
  return DEFAULT_COLUMNS
}

function cellText(col: Column, r: ReportRow): string {
  const v = col.value(r)
  if (v == null) return ''
  return typeof v === 'number' && col.format ? col.format(v) : String(v)
}

/** Prüfbericht je Kontrolltag: App-Tabelle mit wählbaren Spalten und
 * zusätzlichen Kennzahlen (Fett/Eiweiss kg, ECM), dazu ein Drucklayout nach
 * dem Papierbericht der Zuchtorganisation (components/PaperReport.tsx). */
export default function Pruefbericht({ moduleKey }: { moduleKey: string }) {
  const species = speciesOf(moduleKey)
  const sheep = species === 'sheep'
  // Schalmtest-Kreuz/Warnung: bei Kühen ab 150'000 wie auf dem Papierbericht,
  // bei Schafen die Zellzahl-Grenze der Ausmerzliste (dort einstellbar).
  const { thresholds } = useCullingThresholds(moduleKey, species)
  const sccLimit = sheep ? thresholds.sccGeo12m : 150
  const terms = speciesTerms(moduleKey)
  const calvingWord = sheep ? 'Ablammdatum' : 'Kalbedatum'
  const { data } = useQuery(loadTestReportData)
  const dates = useMemo(() => testDates(data?.tests ?? []), [data])
  const [chosenDate, setChosenDate] = useState<string | null>(null)
  const date = chosenDate ?? dates[0]?.date ?? null
  const rows = useMemo(
    () => (data && date ? buildReport(date, data.animals, data.tests, data.lactations, data.services) : []),
    [data, date],
  )
  const summary = useMemo(() => summarize(rows), [rows])

  const allColumns = useMemo(() => columnsFor(calvingWord, sccLimit, !sheep), [calvingWord, sccLimit, sheep])
  const storageKey = `fmis:${moduleKey}:pruefbericht:columns`
  const [columnKeys, setColumnKeys] = useState<string[]>(() => loadColumns(storageKey))
  const [view, setView] = useState<'tabelle' | 'papier'>('tabelle')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDesc, setSortDesc] = useState(true)

  const visible = allColumns.filter((c) => columnKeys.includes(c.key))

  function saveColumns(next: string[]) {
    setColumnKeys(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // gilt dann nur bis zum Reload
    }
  }

  function toggleColumn(key: string) {
    const next = columnKeys.includes(key)
      ? columnKeys.filter((k) => k !== key)
      : allColumns.filter((c) => columnKeys.includes(c.key) || c.key === key).map((c) => c.key)
    if (next.length > 0) saveColumns(next)
  }

  function handleSort(key: string) {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const sorted = useMemo(() => {
    const col = allColumns.find((c) => c.key === sortKey)
    if (!col) return rows
    return [...rows].sort((a, b) => {
      const av = col.value(a)
      const bv = col.value(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'de-CH')
      return sortDesc ? -cmp : cmp
    })
  }, [rows, allColumns, sortKey, sortDesc])

  const groups = [...new Set(allColumns.map((c) => c.group))]
  const pct = (v: number | null) => (v == null ? '–' : `${Math.round(v * 100)} %`)
  const one = (v: number | null, d = 1) => (v == null ? '–' : f(d)(v))

  const paper = date ? (
    <PaperReport date={date} rows={rows} summary={summary} title={terms.plural} calvingWord={calvingWord} sccLimit={sccLimit} withEcm={!sheep} />
  ) : null

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 pb-24">
      <style>{PAPER_CSS}</style>
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-800">Prüfbericht</h1>
        <Link to=".." relative="path" className="text-sm text-brand-700">
          ← Leistung
        </Link>
      </div>

      {!data && <p className="text-center text-gray-400">Lädt…</p>}
      {data && dates.length === 0 && <p className="text-center text-gray-500">Keine Milchproben. {terms.importHint}</p>}

      {date && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={date}
              onChange={(e) => setChosenDate(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {dates.map((d) => (
                <option key={d.date} value={d.date}>
                  {ddmmyyyy(d.date)} ({d.count} {d.count === 1 ? 'Tier' : 'Tiere'})
                </option>
              ))}
            </select>
            <div className="flex rounded-lg border border-gray-300 bg-white text-sm">
              {(
                [
                  ['tabelle', 'Tabelle'],
                  ['papier', 'Papieransicht'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`px-3 py-2 first:rounded-l-lg last:rounded-r-lg ${view === key ? 'bg-brand-700 text-white' : 'text-gray-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => window.print()} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              🖨 Drucken / PDF
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Tiere', String(summary.count)],
              ['⌀ Milch kg', one(summary.milk)],
              sheep ? ['⌀ Laktationstage', one(summary.dim, 0)] : ['⌀ ECM kg', one(summary.ecmKg)],
              ['⌀ Fett+Eiweiss kg', one(summary.fatProteinKg, 2)],
              ['Fett / Eiweiss %', `${one(summary.fat_pct, 2)} / ${one(summary.protein_pct, 2)}`],
              ['⌀ Zellzahl (gew.)', one(summary.scc, 0)],
              ['ZZ < 100 / > 200', `${pct(summary.sccBelow100)} / ${pct(summary.sccAbove200)}`],
              ['Total Milch kg', one(summary.totalMilk)],
            ].map(([label, value], i) => (
              <div key={label} className={`rounded-lg p-3 shadow-sm ${i >= 1 && i <= 3 ? 'bg-brand-50' : 'bg-white'}`}>
                <div className="text-xs text-gray-500">{label}</div>
                <div className="text-lg font-semibold text-gray-800">{value}</div>
              </div>
            ))}
          </div>

          {view === 'tabelle' && (
            <>
              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer select-none">
                  Spalten ({visible.length} von {allColumns.length})
                </summary>
                <div className="mt-1 space-y-1 rounded bg-white p-2 shadow-sm">
                  {groups.map((g) => (
                    <div key={g} className="flex flex-wrap gap-x-3 gap-y-1">
                      <span className="w-full font-semibold text-gray-500 sm:w-32">{g}</span>
                      {allColumns
                        .filter((c) => c.group === g)
                        .map((c) => (
                          <label key={c.key} className="flex items-center gap-1">
                            <input type="checkbox" checked={columnKeys.includes(c.key)} onChange={() => toggleColumn(c.key)} />
                            <span className={c.highlight ? 'font-semibold text-brand-800' : ''}>{c.label}</span>
                          </label>
                        ))}
                    </div>
                  ))}
                  <button type="button" onClick={() => saveColumns(DEFAULT_COLUMNS)} className="text-brand-700 underline">
                    Vorgabe wiederherstellen
                  </button>
                </div>
              </details>

              <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500">
                      <th className="sticky left-0 bg-white px-3 py-2 text-left">{terms.singular}</th>
                      {visible.map((c) => (
                        <th
                          key={c.key}
                          onClick={() => handleSort(c.key)}
                          className={`cursor-pointer select-none whitespace-nowrap px-2 py-2 text-right ${c.highlight ? 'bg-brand-50 text-brand-800' : ''}`}
                        >
                          {c.label}
                          {sortKey === c.key && (sortDesc ? ' ↓' : ' ↑')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.animal.id} className="border-b last:border-0">
                        <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1.5">
                          <Link to={`../kuehe/${r.animal.id}`} relative="path" className="text-gray-800">
                            {r.animal.lauf_nr && <span className="mr-1.5 font-bold">{r.animal.lauf_nr}</span>}
                            {animalLabel(r.animal)}
                          </Link>
                        </td>
                        {visible.map((c) => (
                          <td
                            key={c.key}
                            className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${c.highlight ? 'bg-brand-50 font-semibold text-brand-900' : ''} ${
                              c.warn?.(r) ? 'font-semibold text-red-700' : ''
                            }`}
                          >
                            {cellText(c, r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 text-xs font-semibold text-gray-700">
                      <td className="sticky left-0 bg-white px-3 py-2">Durchschnitt</td>
                      {visible.map((c) => {
                        const v = c.avg?.(summary)
                        return (
                          <td key={c.key} className={`whitespace-nowrap px-2 py-2 text-right tabular-nums ${c.highlight ? 'bg-brand-50' : ''}`}>
                            {v != null && c.format ? c.format(v) : ''}
                          </td>
                        )
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-gray-500">
                Gehalte, Harnstoff und Zellzahl im Durchschnitt nach Milchmenge gewichtet, wie auf dem Prüfbericht. Rot: Zellzahl ab{' '}
                {(sccLimit * 1000).toLocaleString('de-CH')}, Harnstoff ausserhalb 15–27 mg/dl, FEQ über 1.4
                {sheep ? ' (Richtwerte für Kühe)' : ''}.{!sheep && ' ECM = Milch × (0.38·Fett% + 0.24·Eiweiss% + 0.816) / 3.14.'}
              </p>
            </>
          )}

          {view === 'papier' && <div className="overflow-x-auto rounded-lg bg-gray-200 p-2 sm:p-4">{paper}</div>}

          {/* Druckversion: immer das Papierlayout, direkt unter <body>, damit
              Kopfzeile, Navigation und App-Tabelle nicht mitgedruckt werden. */}
          {createPortal(<div id="pruefbericht-print">{paper}</div>, document.body)}
        </>
      )}
    </div>
  )
}
