// Leistungs- und Zellzahlkennzahlen je Muttertier mit Herdenvergleich — 1:1
// portiert aus dem bisherigen Selektionsablauf der Milchschafe
// (Nextcloud …/Tierlisten smg/…/scripts/selektion.py, WORKFLOW.md):
//
// - Lebenstagleistung (LTL) = kg Milch aller abgeschlossenen + der laufenden
//   Laktation / Lebenstage am Stichtag.
// - Altersstandardisierung: Vergleich mit Herdengenossinnen gleicher
//   Laktationszahl (rel = LTL / Gruppenmittel); Gruppen < 5 Tiere werden aus
//   den Nachbargruppen interpoliert.
// - Erstlinge in laufender 1. Laktation: Standardlaktation (Abschlusscode 9)
//   statt LTL, verglichen mit dem Mittel der Erstlinge (mind. 3).
// - Zellzahl: geometrisches Mittel der Einzelkontrollen (1000 Zellen/ml).
// - Index: z-standardisiert auf Mittel 100 / Streuung 10, Zellzahl log und
//   umgekehrt (tief = gut); Gesamtindex gewichtet, fehlende Teilwerte = 100.
//
// Abweichung zum Original: Abschlusscodes 4–7 zählen ebenfalls als
// abgeschlossen (bei Kühen weitere Abschlussvarianten, bei Schafen ungenutzt).

import { daysBetween } from './format'

const COMPLETE_CODES = new Set([1, 2, 3, 4, 5, 6, 7])
const RUNNING_ACTUAL = 8
const RUNNING_STANDARD = 9
const MIN_GROUP = 5

export interface LactationInput {
  lactation_number: number
  closure_type: number
  milk_kg: number | null
  fat_kg: number | null
  protein_kg: number | null
  days_in_milk: number | null
  calving_date: string | null
}

export interface PerformanceInput {
  id: string
  birth_date: string | null
  lactations: LactationInput[]
  /** Zellzahl je Kontrolle in 1000 Zellen/ml (K33 109–112). */
  tests: { test_date: string; cell_count: number | null }[]
}

export type DataBasis = 'gut' | 'mittel' | 'duenn'

export interface PerformanceMetrics {
  id: string
  lifetime_days: number | null
  n_lactations: number
  n_running: number
  lactation_group: number
  milk_total: number
  fat_protein_total: number
  ltl_milk: number | null
  ltl_fe: number | null
  standard_milk: number | null
  ltl_milk_expected: number | null
  ltl_milk_rel: number | null
  ltl_fe_rel: number | null
  performance_rel: number | null
  performance_basis: 'Lebenstagleistung' | 'Standardlaktation' | null
  scc_geo: number | null
  scc_geo_12m: number | null
  scc_max: number | null
  n_tests: number
  data_basis: DataBasis
  idx_performance: number | null
  idx_scc: number | null
  idx_scc_12m: number | null
}

function round(v: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

export function geoMean(values: (number | null)[]): number | null {
  const vals = values.filter((v): v is number => v != null && v > 0)
  if (!vals.length) return null
  return Math.exp(vals.reduce((s, v) => s + Math.log(v), 0) / vals.length)
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

/** z-Standardisierung auf Mittel 100 / Streuung 10 (Populations-SD wie
 * statistics.pstdev). Nur Werte > 0 zählen; mit weniger als zwei Werten
 * gibt es keinen Index. */
export function indexScale(values: Map<string, number | null>, options: { invert?: boolean; log?: boolean } = {}): Map<string, number | null> {
  const present = [...values].filter((e): e is [string, number] => e[1] != null && e[1] > 0)
  const out = new Map<string, number | null>([...values.keys()].map((k) => [k, null]))
  if (present.length < 2) return out
  const xs = new Map(present.map(([k, v]) => [k, options.log ? Math.log(v) : v]))
  const m = mean([...xs.values()])
  const sd = Math.sqrt(mean([...xs.values()].map((x) => (x - m) ** 2))) || 1
  for (const [k, x] of xs) {
    const z = ((x - m) / sd) * (options.invert ? -1 : 1)
    out.set(k, round(100 + 10 * z, 1))
  }
  return out
}

/** Erwartungswert je Laktationsgruppe; Gruppen mit < 5 Tieren aus den
 * Nachbargruppen linear interpoliert (bzw. vom nächsten Nachbarn übernommen). */
export function expectedByGroup(values: { group: number; value: number }[]): Map<number, number> {
  const groups = new Map<number, number[]>()
  for (const { group, value } of values) groups.set(group, [...(groups.get(group) ?? []), value])
  const levels = [...groups.keys()].sort((a, b) => a - b)
  const expected = new Map<number, number>()
  for (const g of levels) if (groups.get(g)!.length >= MIN_GROUP) expected.set(g, mean(groups.get(g)!))
  const solid = [...expected.keys()]
  for (const g of levels) {
    if (expected.has(g)) continue
    const below = solid.filter((x) => x < g)
    const above = solid.filter((x) => x > g)
    if (below.length && above.length) {
      const u = Math.max(...below)
      const o = Math.min(...above)
      expected.set(g, expected.get(u)! + ((g - u) / (o - u)) * (expected.get(o)! - expected.get(u)!))
    } else if (below.length) expected.set(g, expected.get(Math.max(...below))!)
    else if (above.length) expected.set(g, expected.get(Math.min(...above))!)
    else expected.set(g, mean(groups.get(g)!))
  }
  return expected
}

export function computeHerdPerformance(animals: PerformanceInput[], stichtag: string): Map<string, PerformanceMetrics> {
  const base = animals.map((a) => {
    const complete = new Map<number, LactationInput>()
    const running = new Map<number, LactationInput>()
    let standard: LactationInput | null = null
    for (const l of a.lactations) {
      if (COMPLETE_CODES.has(l.closure_type)) {
        const cur = complete.get(l.lactation_number)
        if (!cur || (l.days_in_milk ?? 0) > (cur.days_in_milk ?? 0)) complete.set(l.lactation_number, l)
      } else if (l.closure_type === RUNNING_ACTUAL) {
        running.set(l.lactation_number, l)
      } else if (l.closure_type === RUNNING_STANDARD) {
        if (!standard || l.lactation_number >= standard.lactation_number) standard = l
      }
    }
    let milk = 0
    let fe = 0
    let nRunning = 0
    for (const l of complete.values()) {
      milk += l.milk_kg ?? 0
      fe += (l.fat_kg ?? 0) + (l.protein_kg ?? 0)
    }
    for (const [nr, l] of running) {
      if (complete.has(nr)) continue
      milk += l.milk_kg ?? 0
      fe += (l.fat_kg ?? 0) + (l.protein_kg ?? 0)
      nRunning++
    }
    const lifetime = a.birth_date ? daysBetween(a.birth_date, stichtag) : null
    const cutoff12m = new Date(Date.parse(`${stichtag}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10)
    const scc = a.tests.map((t) => t.cell_count).filter((v): v is number => v != null && v > 0)
    const scc12 = a.tests
      .filter((t) => t.cell_count != null && t.cell_count > 0 && t.test_date >= cutoff12m)
      .map((t) => t.cell_count)
    const geo = geoMean(scc)
    const geo12 = geoMean(scc12)
    return {
      id: a.id,
      lifetime_days: lifetime,
      n_lactations: complete.size,
      n_running: nRunning,
      lactation_group: complete.size + nRunning,
      milk_total: milk,
      fat_protein_total: fe,
      ltl_milk: lifetime && milk ? round(milk / lifetime, 3) : null,
      ltl_fe: lifetime && fe ? round(fe / lifetime, 4) : null,
      standard_milk: (standard as LactationInput | null)?.milk_kg ?? null,
      scc_geo: geo != null ? Math.round(geo) : null,
      scc_geo_12m: geo12 != null ? Math.round(geo12) : null,
      scc_max: scc.length ? Math.max(...scc) : null,
      n_tests: scc.length,
    }
  })

  const relTo = (field: 'ltl_milk' | 'ltl_fe') => {
    const expected = expectedByGroup(
      base.filter((b) => b[field]).map((b) => ({ group: b.lactation_group, value: b[field]! })),
    )
    return new Map(
      base.map((b) => {
        const e = expected.get(b.lactation_group)
        return [b.id, { expected: e != null ? round(e, 3) : null, rel: b[field] && e ? round(b[field]! / e, 3) : null }]
      }),
    )
  }
  const milkRel = relTo('ltl_milk')
  const feRel = relTo('ltl_fe')

  const firstStd = base.filter((b) => b.lactation_group === 1 && b.standard_milk).map((b) => b.standard_milk!)
  const meanFirstStd = firstStd.length >= 3 ? mean(firstStd) : null

  const partial = base.map((b) => {
    let performance_rel: number | null = null
    let performance_basis: PerformanceMetrics['performance_basis'] = null
    if (b.n_lactations) {
      performance_rel = milkRel.get(b.id)!.rel
      performance_basis = performance_rel != null ? 'Lebenstagleistung' : null
    } else if (b.standard_milk && meanFirstStd) {
      performance_rel = round(b.standard_milk / meanFirstStd, 3)
      performance_basis = 'Standardlaktation'
    }
    const data_basis: DataBasis =
      b.n_lactations && b.n_tests >= 5 ? 'gut' : performance_rel && b.n_tests >= 3 ? 'mittel' : 'duenn'
    return {
      ...b,
      ltl_milk_expected: milkRel.get(b.id)!.expected,
      ltl_milk_rel: milkRel.get(b.id)!.rel,
      ltl_fe_rel: feRel.get(b.id)!.rel,
      performance_rel,
      performance_basis,
      data_basis,
    }
  })

  const idxPerf = indexScale(new Map(partial.map((p) => [p.id, p.performance_rel])))
  const idxScc = indexScale(new Map(partial.map((p) => [p.id, p.scc_geo])), { invert: true, log: true })
  const idxScc12 = indexScale(new Map(partial.map((p) => [p.id, p.scc_geo_12m])), { invert: true, log: true })

  return new Map(
    partial.map((p) => [
      p.id,
      { ...p, idx_performance: idxPerf.get(p.id) ?? null, idx_scc: idxScc.get(p.id) ?? null, idx_scc_12m: idxScc12.get(p.id) ?? null },
    ]),
  )
}

/** Gesamtindex wie im Original: fehlender Teilwert = Herdenmittel 100,
 * damit ein Tier ohne Leistungsdaten nicht allein wegen tiefer Zellzahl an
 * die Spitze rutscht. */
export function totalIndex(idxPerformance: number | null, idxScc: number | null, weightPerformance = 0.6, weightScc = 0.4): number | null {
  if (idxPerformance == null && idxScc == null) return null
  return round(weightPerformance * (idxPerformance ?? 100) + weightScc * (idxScc ?? 100), 1)
}
