import { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, fmtKg, fmtPct, num } from '../lib/format'
import { selectYogurtCows, TARGET_PROTEIN_PCT, type YogurtSelectionResult } from '../lib/yogurtSelection'
import { speciesTerms } from '../lib/species'
import type { AnimalMilkCurrent, LactationSummary } from '../types'

type SortKey =
  | 'name'
  | 'test_date'
  | 'milk_kg'
  | 'fat_kg'
  | 'protein_kg'
  | 'fat_protein_kg'
  | 'ecm_kg'
  | 'protein_pct'

const CLOSURE_TYPE_LABEL: Record<number, string> = {
  1: 'Teilabschluss',
  2: 'Standardabschluss (305 Tage)',
  3: 'Vollabschluss',
  4: '100-Tage-Abschluss',
  5: '200-Tage-Abschluss',
  6: '305-Tage-Abschluss',
  7: '305-Tage-Abschluss (laufend)',
  8: 'laufend',
  9: 'prognostiziert',
}

// pglite liefert numeric-Spalten als string (siehe lib/format.ts) — hier auf
// echte number normalisieren, damit Sortierung und die Joghurt-Auswahl
// (Addition/Division) nicht versehentlich auf Strings arbeiten (Verkettung
// statt Summe). Fett-/Eiweiss-Werte bleiben null bei Wägungen ohne
// Laboranalyse (has_analysis = false, siehe schema/0004).
//
// analysedOnly: statt der neuesten Wägung die neueste MIT Laboranalyse pro
// Tier (View v_animal_milk_current_analysed) — der Filter lässt also kein
// Tier verschwinden, sondern zeigt dessen letzte vollständige Wägung.
function loadCurrentMilk(analysedOnly: boolean) {
  const view = analysedOnly ? 'v_animal_milk_current_analysed' : 'v_animal_milk_current'
  return async (pg: PGlite): Promise<AnimalMilkCurrent[]> => {
    const { rows } = await pg.query<AnimalMilkCurrent>(
      `select * from ${view} where status = 'aktiv' order by protein_pct desc nulls last`,
    )
    return rows.map((r) => ({
      ...r,
      milk_kg: num(r.milk_kg) ?? 0,
      fat_pct: num(r.fat_pct),
      protein_pct: num(r.protein_pct),
      fat_kg: num(r.fat_kg),
      protein_kg: num(r.protein_kg),
      fat_protein_kg: num(r.fat_protein_kg),
      ecm_kg: num(r.ecm_kg),
      has_analysis: Boolean(r.has_analysis),
    }))
  }
}

async function loadLactationSummary(pg: PGlite): Promise<LactationSummary[]> {
  const { rows } = await pg.query<LactationSummary>(
    `select * from v_lactation_summary order by name, ear_tag, lactation_number desc`,
  )
  return rows.map((r) => ({
    ...r,
    milk_kg: num(r.milk_kg),
    fat_kg: num(r.fat_kg),
    fat_pct: num(r.fat_pct),
    protein_kg: num(r.protein_kg),
    protein_pct: num(r.protein_pct),
    fat_protein_kg: num(r.fat_protein_kg),
  }))
}

export default function Milk({ moduleKey }: { moduleKey: string }) {
  const terms = speciesTerms(moduleKey)
  const [analysedOnly, setAnalysedOnly] = useState(false)
  const { data, loading } = useQuery(loadCurrentMilk(analysedOnly), [analysedOnly])
  const { data: lactationData, loading: lactationLoading } = useQuery(loadLactationSummary)
  const cows = data ?? []
  const lactations = lactationData ?? []
  const [sortKey, setSortKey] = useState<SortKey>('protein_pct')
  // Zwei Tabs: Laktationsleistung (Abschlüsse) und letzte Milchwägung.
  const [tab, setTab] = useState<'laktation' | 'waegung'>('laktation')
  // Joghurt-Auswahl nur für Milchkühe — Nebengeleise, deshalb eingeklappt
  // unter "Benutzerdefinierte Filter und Aktionen".
  const showYogurt = moduleKey === 'dairy'
  const [sortDesc, setSortDesc] = useState(true)
  const [selection, setSelection] = useState<YogurtSelectionResult | null>(null)

  const sorted = useMemo(() => {
    const copy = [...cows]
    copy.sort((a, b) => {
      const av = sortKey === 'name' ? (a.name ?? a.ear_tag) : a[sortKey]
      const bv = sortKey === 'name' ? (b.name ?? b.ear_tag) : b[sortKey]
      // Wägungen ohne Laboranalyse (null) immer ans Ende, egal welche Richtung.
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDesc ? -cmp : cmp
    })
    return copy
  }, [cows, sortKey, sortDesc])

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d)
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const selectedIds = useMemo(
    () => new Set(selection?.selected.map((c) => c.animal_id) ?? []),
    [selection],
  )
  const withoutAnalysis = cows.filter((c) => !c.has_analysis).length

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-800">Leistung</h1>

      <div className="flex gap-1 border-b">
        {(
          [
            ['laktation', 'Laktationsleistung'],
            ['waegung', 'Letzte Milchwägung'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key ? 'border-brand-600 text-brand-800' : 'border-transparent text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'waegung' && loading && !data && <p className="text-center text-gray-400">Lädt…</p>}
      {tab === 'waegung' && data && cows.length === 0 && !analysedOnly && (
        <p className="text-center text-gray-500">
          Keine aktuellen Milchtests. {terms.importHint}
        </p>
      )}

      {tab === 'waegung' && (cows.length > 0 || analysedOnly) && (
        <>
          <details className="rounded-lg bg-white shadow-sm">
          <summary className="cursor-pointer select-none px-4 py-2 text-sm font-semibold text-gray-700">
            Benutzerdefinierte Filter und Aktionen
          </summary>
          <div className="space-y-3 border-t px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={analysedOnly}
              onChange={(e) => setAnalysedOnly(e.target.checked)}
              className="h-4 w-4"
            />
            Nur Wägungen mit Laboranalyse (Fett/Eiweiss)
            {!analysedOnly && withoutAnalysis > 0 && (
              <span className="text-xs text-gray-500">
                — {withoutAnalysis} {withoutAnalysis === 1 ? 'Tier' : 'Tiere'} aktuell ohne Analyse
              </span>
            )}
          </label>
          {showYogurt && cows.length > 0 && (
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Joghurt-Auswahl ({terms.plural})</h2>
                <p className="text-xs text-gray-500">
                  Grösstmögliche Milchmenge mit gewichtetem Ø-Eiweiss ≥ {TARGET_PROTEIN_PCT}%.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelection(selectYogurtCows(cows))}
                className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white active:bg-brand-800"
              >
                Joghurt-{terms.plural} vorschlagen
              </button>
            </div>
            {selection && (
              <div className="mt-3 rounded bg-brand-50 p-3 text-sm text-brand-900">
                {selection.selected.length === 0 ? (
                  <p>Keine {terms.singular} erreicht allein {TARGET_PROTEIN_PCT}% Eiweiss — keine Auswahl möglich.</p>
                ) : (
                  <p>
                    {selection.selected.length} {terms.plural} ausgewählt · {fmtKg(selection.totalMilkKg)} Milch ·
                    gewichteter Ø-Eiweiss {fmtPct(selection.weightedProteinPct)}
                  </p>
                )}
                {selection.skippedWithoutAnalysis > 0 && (
                  <p className="mt-1 text-xs text-amber-700">
                    {selection.skippedWithoutAnalysis} {terms.plural} ohne Laboranalyse nicht berücksichtigt
                    (kein %Eiweiss bekannt).
                  </p>
                )}
              </div>
            )}
          </div>
          )}
          </div>
          </details>
          {analysedOnly && cows.length === 0 && (
            <p className="text-center text-gray-500">Keine Wägungen mit Laboranalyse vorhanden.</p>
          )}

          <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <Th label={terms.singular} active={sortKey === 'name'} onClick={() => handleSort('name')} />
                  <Th
                    label="Testdatum"
                    active={sortKey === 'test_date'}
                    onClick={() => handleSort('test_date')}
                  />
                  <Th label="Milch" active={sortKey === 'milk_kg'} onClick={() => handleSort('milk_kg')} />
                  <Th
                    label="kg Fett"
                    active={sortKey === 'fat_kg'}
                    onClick={() => handleSort('fat_kg')}
                    emphasize
                  />
                  <Th
                    label="kg Eiweiss"
                    active={sortKey === 'protein_kg'}
                    onClick={() => handleSort('protein_kg')}
                    emphasize
                  />
                  <Th
                    label="kg F+E"
                    active={sortKey === 'fat_protein_kg'}
                    onClick={() => handleSort('fat_protein_kg')}
                    emphasize
                  />
                  <Th
                    label="kg ECM"
                    active={sortKey === 'ecm_kg'}
                    onClick={() => handleSort('ecm_kg')}
                    emphasize
                  />
                  <Th
                    label="% Eiweiss"
                    active={sortKey === 'protein_pct'}
                    onClick={() => handleSort('protein_pct')}
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
                  <tr
                    key={c.animal_id}
                    className={`border-b last:border-0 ${
                      selectedIds.has(c.animal_id) ? 'bg-brand-50' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-gray-800">{c.name ?? c.ear_tag}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {fmtDate(c.test_date)}
                      {!c.has_analysis && (
                        <span
                          className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                          title="Wägung ohne Laboranalyse — nur Milchmenge bekannt"
                        >
                          ohne Analyse
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{fmtKg(c.milk_kg)}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800">{fmtKg(c.fat_kg)}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800">{fmtKg(c.protein_kg)}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800">{fmtKg(c.fat_protein_kg)}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800">{fmtKg(c.ecm_kg)}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtPct(c.protein_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'laktation' && lactationLoading && !lactationData && <p className="text-center text-gray-400">Lädt…</p>}
      {tab === 'laktation' && lactationData && lactations.length === 0 && (
        <p className="text-center text-gray-500">
          Keine Laktationsdaten. {terms.importHint}
        </p>
      )}
      {tab === 'laktation' && lactations.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">{terms.singular}</th>
                <th className="px-3 py-2 font-medium">Lakt.-Nr.</th>
                <th className="px-3 py-2 font-medium">Kalbedatum</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Tage</th>
                <th className="px-3 py-2 font-medium">Milch kg</th>
                <th className="px-3 py-2 font-medium">kg Fett</th>
                <th className="px-3 py-2 font-medium">kg Eiweiss</th>
                <th className="px-3 py-2 font-medium">kg F+E</th>
              </tr>
            </thead>
            <tbody>
              {lactations.map((l) => (
                <tr key={l.lactation_id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium text-gray-800">{l.name ?? l.ear_tag}</td>
                  <td className="px-3 py-2 text-gray-600">{l.lactation_number}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtDate(l.calving_date)}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {CLOSURE_TYPE_LABEL[l.closure_type] ?? l.closure_type}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{l.days_in_milk ?? '–'}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtKg(l.milk_kg)}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtKg(l.fat_kg)}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtKg(l.protein_kg)}</td>
                  <td className="px-3 py-2 font-semibold text-gray-800">{fmtKg(l.fat_protein_kg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({
  label,
  active,
  onClick,
  emphasize,
}: {
  label: string
  active: boolean
  onClick: () => void
  emphasize?: boolean
}) {
  return (
    <th
      onClick={onClick}
      className={`cursor-pointer select-none px-3 py-2 font-medium active:bg-gray-100 ${
        active ? 'text-brand-700' : ''
      } ${emphasize ? 'font-semibold' : ''}`}
    >
      {label}
      {active ? ' ▾' : ''}
    </th>
  )
}
