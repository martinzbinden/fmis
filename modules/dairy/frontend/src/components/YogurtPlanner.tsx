import { useMemo, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDate, isoDate, num, todayIso } from '../lib/format'
import { isDrySql } from '../lib/dryOff'
import { CRITERION_LABEL, exclusion, suggestYogurt, yogurtMix, type YogurtCow, type YogurtCriterion, type YogurtOptions } from '../lib/yogurtPlan'

/** Letzte Wägung je aktivem Tier; fehlt dort die Laboranalyse, die Gehalte
 * der letzten analysierten Wägung. */
async function loadCows(pg: PGlite): Promise<YogurtCow[]> {
  const [latest, analysed] = await Promise.all([
    pg.query<Record<string, unknown>>(
      `select distinct on (a.id) a.id as animal_id, a.ear_tag, a.name, a.lauf_nr, t.test_date, t.milk_kg, t.fat_pct, t.protein_pct, t.cell_count,
              (${isDrySql('a')}) as dry,
              (select max(j.entry_date + j.withdrawal_milk_days) from animal_journal j
                where j.animal_id = a.id and j.deleted_at is null and j.withdrawal_milk_days > 0) as withdrawal_until
       from animals a join milk_tests t on t.animal_id = a.id and t.deleted_at is null
       where a.deleted_at is null and a.status = 'aktiv'
       order by a.id, t.test_date desc`,
    ),
    pg.query<Record<string, unknown>>(
      `select distinct on (t.animal_id) t.animal_id, t.test_date, t.fat_pct, t.protein_pct, t.cell_count
       from milk_tests t where t.deleted_at is null and t.protein_pct is not null
       order by t.animal_id, t.test_date desc`,
    ),
  ])
  const lab = new Map(analysed.rows.map((r) => [String(r.animal_id), r]))
  return latest.rows.map((r) => {
    const hasLab = num(r.protein_pct) != null
    const l = hasLab ? null : lab.get(String(r.animal_id))
    const name = r.name ? ` ${r.name}` : ''
    return {
      animal_id: String(r.animal_id),
      label: `${r.lauf_nr ?? String(r.ear_tag).slice(-4)}${name}`,
      test_date: isoDate(r.test_date)!,
      milk_kg: num(r.milk_kg) ?? 0,
      fat_pct: num(hasLab ? r.fat_pct : l?.fat_pct),
      protein_pct: num(hasLab ? r.protein_pct : l?.protein_pct),
      cell_count: num(r.cell_count) ?? num(l?.cell_count),
      analysis_date: l ? isoDate(l.test_date) : null,
      dry: Boolean(r.dry),
      withdrawal_until: isoDate(r.withdrawal_until),
    }
  })
}

const f1 = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const f2 = (v: number) => v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// Zellzahl ist in 1000/ml gespeichert (Milchprüfung)
const scc = (v: number | null) => (v == null ? '–' : `${Math.round(v).toLocaleString('de-CH')}'000`)
const STORAGE_KEY = 'dairy_yogurt_planner_v2'

function loadSettings(): YogurtOptions {
  const d: YogurtOptions = { targetKg: 100, factor: 1, criterion: 'eiweiss', maxCellCount: 250 }
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<YogurtOptions>) }
  } catch {
    return d
  }
}

/** Joghurt-Planer: Milchmenge eingeben → geeignetste Kühe vorgeschlagen
 * (nach Eiweiss, Fett+Eiweiss oder Zellzahl), von Hand an-/abwählbar;
 * Gehalte der Mischmilch (Fett, Eiweiss, Zellzahl) laufend gerechnet. */
export default function YogurtPlanner() {
  const { data, loading } = useQuery(loadCows, [])
  const [opts, setOptsState] = useState<YogurtOptions>(loadSettings)
  const setOpts = (patch: Partial<YogurtOptions>) => {
    const next = { ...opts, ...patch }
    setOptsState(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // nur im Speicher
    }
  }
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [suggested, setSuggested] = useState<Set<string>>(new Set())
  const today = todayIso()
  const cows = data ?? []

  const rows = useMemo(
    () =>
      cows
        .map((c) => ({ c, ex: exclusion(c, opts, today) }))
        .sort(
          (a, b) =>
            Number(a.ex?.blocked ?? false) - Number(b.ex?.blocked ?? false) ||
            Number(!!a.ex) - Number(!!b.ex) ||
            (opts.criterion === 'zellzahl'
              ? (a.c.cell_count ?? Infinity) - (b.c.cell_count ?? Infinity)
              : (b.c.protein_pct ?? 0) + (opts.criterion === 'fett_eiweiss' ? (b.c.fat_pct ?? 0) : 0) - (a.c.protein_pct ?? 0) - (opts.criterion === 'fett_eiweiss' ? (a.c.fat_pct ?? 0) : 0)),
        ),
    [cows, opts, today],
  )

  function suggest() {
    const ids = new Set(suggestYogurt(cows, opts, today))
    setPicked(ids)
    setSuggested(ids)
  }
  const selected = cows.filter((c) => picked?.has(c.animal_id))
  const mix = yogurtMix(selected, opts.factor)
  const missing = opts.targetKg - mix.milkKg
  const manual = picked != null && (selected.length !== suggested.size || selected.some((c) => !suggested.has(c.animal_id)))
  const toggle = (id: string) => {
    const next = new Set(picked ?? [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  if (loading && !data) return <p className="text-sm text-gray-400">Lädt…</p>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">Milchmenge kg</span>
          <input
            inputMode="decimal"
            value={opts.targetKg || ''}
            onChange={(e) => setOpts({ targetKg: Number(e.target.value.replace(',', '.')) || 0 })}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-base font-semibold"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">aus</span>
          <select value={opts.factor} onChange={(e) => setOpts({ factor: Number(e.target.value) })} className="w-full rounded border border-gray-300 px-2 py-1.5">
            <option value={1}>Tagesmilch (2 Gemelke)</option>
            <option value={0.5}>1 Gemelk</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">Kühe mit</span>
          <select value={opts.criterion} onChange={(e) => setOpts({ criterion: e.target.value as YogurtCriterion })} className="w-full rounded border border-gray-300 px-2 py-1.5">
            {(Object.keys(CRITERION_LABEL) as YogurtCriterion[]).map((k) => (
              <option key={k} value={k}>
                {CRITERION_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-600">Zellzahl höchstens (1000/ml)</span>
          <input
            inputMode="numeric"
            value={opts.maxCellCount ?? ''}
            placeholder="egal"
            onChange={(e) => setOpts({ maxCellCount: e.target.value.trim() ? Number(e.target.value) || null : null })}
            className="w-full rounded border border-gray-300 px-2 py-1.5"
          />
        </label>
      </div>
      <button type="button" onClick={suggest} className="w-full rounded-lg bg-brand-700 py-2 text-sm font-semibold text-white active:bg-brand-800">
        Geeignetste Kühe für {opts.targetKg.toLocaleString('de-CH')} kg vorschlagen
      </button>

      {picked && (
        <div className={`rounded-lg p-3 text-sm ${missing > 0 ? 'bg-amber-50 text-amber-900' : 'bg-brand-50 text-brand-900'}`}>
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div>
              <div className="text-xs opacity-70">Milch</div>
              <div className="text-xl font-bold">{f1(mix.milkKg)} kg</div>
              <div className="text-xs">{mix.n} Kühe</div>
            </div>
            <div>
              <div className="text-xs opacity-70">Eiweiss</div>
              <div className="text-xl font-bold">{mix.proteinPct != null ? `${f2(mix.proteinPct)} %` : '–'}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">Fett</div>
              <div className="text-xl font-bold">{mix.fatPct != null ? `${f2(mix.fatPct)} %` : '–'}</div>
            </div>
            <div>
              <div className="text-xs opacity-70">Zellzahl</div>
              <div className="text-xl font-bold">{scc(mix.cellCount)}</div>
            </div>
          </div>
          <p className="mt-2 text-center text-xs">
            {missing > 0 ? `Es fehlen ${f1(missing)} kg — weitere Kühe dazunehmen.` : `Ziel ${opts.targetKg.toLocaleString('de-CH')} kg erreicht (+${f1(-missing)} kg).`}
            {manual ? ' · von Hand angepasst' : ''}
            {mix.unknownKg > 0 ? ` · ${f1(mix.unknownKg)} kg ohne Laboranalyse (in den Gehalten nicht enthalten)` : ''}
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="px-1.5 py-2" />
              <th className="px-1.5 py-2">Kuh</th>
              <th className="px-1.5 py-2 text-right">kg</th>
              <th className="px-1.5 py-2 text-right">Eiw. %</th>
              <th className="px-1.5 py-2 text-right">Fett %</th>
              <th className="px-1.5 py-2 text-right">Zellen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, ex }) => {
              const on = picked?.has(c.animal_id) ?? false
              return (
                <tr
                  key={c.animal_id}
                  onClick={() => !ex?.blocked && toggle(c.animal_id)}
                  className={`cursor-pointer border-b last:border-0 ${ex?.blocked ? 'cursor-not-allowed opacity-40' : ''} ${on ? 'bg-brand-50' : ''}`}
                >
                  <td className="px-1.5 py-1.5">
                    <input type="checkbox" disabled={ex?.blocked} checked={on} readOnly className="pointer-events-none h-4 w-4" />
                  </td>
                  <td className="px-1.5 py-1.5">
                    <span className="font-medium">{c.label}</span>
                    <span className="block text-[11px] text-gray-500">
                      {fmtDate(c.test_date)}
                      {c.analysis_date ? ` · Gehalte ${fmtDate(c.analysis_date)}` : ''}
                      {ex && <span className={ex.blocked ? ' text-red-700' : ' text-amber-700'}> · {ex.reason}</span>}
                    </span>
                  </td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{f1(c.milk_kg * opts.factor)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{c.protein_pct != null ? f2(c.protein_pct) : '–'}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums">{c.fat_pct != null ? f2(c.fat_pct) : '–'}</td>
                  <td className={`px-1.5 py-1.5 text-right tabular-nums ${opts.maxCellCount != null && (c.cell_count ?? 0) > opts.maxCellCount ? 'text-red-700' : ''}`}>
                    {c.cell_count != null ? Math.round(c.cell_count).toLocaleString('de-CH') : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Milchmenge und Gehalte aus der letzten Milchwägung je Kuh (ohne Laboranalyse: Gehalte der letzten analysierten). Gehalte und Zellzahl
        der Mischung sind mengengewichtet; Zellen in 1000/ml. Zeile antippen = an-/abwählen. Trockene Kühe und Kühe mit offener
        Milch-Absetzfrist sind gesperrt.
      </p>
    </div>
  )
}
