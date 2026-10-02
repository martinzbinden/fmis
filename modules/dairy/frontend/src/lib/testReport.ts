// Prüfbericht ("Ergebnisse der Milchleistungskontrolle") je Kontrolldatum —
// aus Milchproben (K33), Laktationen (K04) und Belegungen gerechnet, Aufbau
// angelehnt an den Papierbericht der Zuchtorganisation.

import { daysBetween } from './format'

export interface ReportTest {
  animal_id: string
  test_date: string
  calving_date: string | null
  lactation_number: number | null
  milk_kg: number
  fat_pct: number | null
  protein_pct: number | null
  lactose_pct: number | null
  cell_count: number | null
  urea_mg_dl: number | null
  milk_morning_kg: number | null
  milk_evening_kg: number | null
  sample_persistency: number | null
  bhb_mmol: number | null
  acetone_mmol: number | null
}

export interface ReportLactation {
  animal_id: string
  lactation_number: number
  closure_type: number
  days_in_milk: number | null
  milk_kg: number | null
  fat_pct: number | null
  protein_pct: number | null
  cell_count: number | null
  persistency: number | null
}

export interface ReportAnimal {
  id: string
  ear_tag: string
  name: string | null
  lauf_nr: string | null
}

export interface ReportRow {
  animal: ReportAnimal
  test: ReportTest
  dim: number | null
  /** Milchmenge des gewogenen Gemelks (AT4: nur Morgen ODER Abend). */
  sampleMilk: number | null
  fatKg: number | null
  proteinKg: number | null
  fatProteinKg: number | null
  ecmKg: number | null
  feq: number | null
  sccPrevious: number | null
  /** Laufende Laktation (Ist, Abschlusscode 8) — nur wenn diese Probe die
   * neueste des Tiers ist, sonst passt der kumulierte Stand nicht zum Datum. */
  current: { days: number | null; milk: number | null; fat_pct: number | null; protein_pct: number | null; scc: number | null; persistency: number | null } | null
  /** Aufgerechnete bzw. Standardlaktation (Code 9, sonst 2). */
  standard: { days: number | null; milk: number | null; fat_pct: number | null; protein_pct: number | null; persistency: number | null; projected: boolean } | null
  lastService: string | null
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/** ECM wie in schema/0004_optional_analysis.sql: Milch × (0.38 Fett% + 0.24 Eiweiss% + 0.816) / 3.14. */
export function ecm(milk: number, fat: number, protein: number): number {
  return round((milk * (0.38 * fat + 0.24 * protein + 0.816)) / 3.14, 1)
}

export function testDates(tests: { test_date: string }[]): { date: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of tests) counts.set(t.test_date, (counts.get(t.test_date) ?? 0) + 1)
  return [...counts].map(([date, count]) => ({ date, count })).sort((a, b) => b.date.localeCompare(a.date))
}

export function buildReport(
  date: string,
  animals: ReportAnimal[],
  tests: ReportTest[],
  lactations: ReportLactation[],
  services: { animal_id: string; service_date: string }[],
): ReportRow[] {
  const animalById = new Map(animals.map((a) => [a.id, a]))
  const testsByAnimal = new Map<string, ReportTest[]>()
  for (const t of tests) testsByAnimal.set(t.animal_id, [...(testsByAnimal.get(t.animal_id) ?? []), t])
  for (const list of testsByAnimal.values()) list.sort((a, b) => a.test_date.localeCompare(b.test_date))

  const rows: ReportRow[] = []
  for (const [animalId, list] of testsByAnimal) {
    const idx = list.findIndex((t) => t.test_date === date)
    const animal = animalById.get(animalId)
    if (idx === -1 || !animal) continue
    const t = list[idx]
    const prev = list[idx - 1]
    const isLatest = idx === list.length - 1
    const lacts = lactations.filter((l) => l.animal_id === animalId && l.lactation_number === t.lactation_number)
    const cur = lacts.find((l) => l.closure_type === 8)
    const std = lacts.find((l) => l.closure_type === 9) ?? lacts.find((l) => l.closure_type === 2)
    const hasAnalysis = t.fat_pct != null && t.protein_pct != null
    const fatKg = hasAnalysis ? round((t.milk_kg * t.fat_pct!) / 100, 2) : null
    const proteinKg = hasAnalysis ? round((t.milk_kg * t.protein_pct!) / 100, 2) : null
    const service = services
      .filter((s) => s.animal_id === animalId && (!t.calving_date || s.service_date > t.calving_date))
      .map((s) => s.service_date)
      .sort()
      .at(-1)
    rows.push({
      animal,
      test: t,
      dim: t.calving_date ? daysBetween(t.calving_date, t.test_date) : null,
      sampleMilk: t.milk_morning_kg ?? t.milk_evening_kg,
      fatKg,
      proteinKg,
      fatProteinKg: fatKg != null && proteinKg != null ? round(fatKg + proteinKg, 2) : null,
      ecmKg: hasAnalysis ? ecm(t.milk_kg, t.fat_pct!, t.protein_pct!) : null,
      feq: hasAnalysis && t.protein_pct ? round(t.fat_pct! / t.protein_pct, 2) : null,
      sccPrevious: prev?.cell_count ?? null,
      current:
        isLatest && cur
          ? { days: cur.days_in_milk, milk: cur.milk_kg, fat_pct: cur.fat_pct, protein_pct: cur.protein_pct, scc: cur.cell_count, persistency: cur.persistency }
          : null,
      standard: std
        ? { days: std.days_in_milk, milk: std.milk_kg, fat_pct: std.fat_pct, protein_pct: std.protein_pct, persistency: std.persistency, projected: std.closure_type === 9 }
        : null,
      lastService: service ?? null,
    })
  }
  // Wie auf dem Papier: jüngste Abkalbung zuerst.
  return rows.sort((a, b) => (b.test.calving_date ?? '').localeCompare(a.test.calving_date ?? ''))
}

function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null)
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}

/** Mittel gewichtet nach Milchmenge (wie auf dem Prüfbericht für Gehalte,
 * Harnstoff und Zellzahl). */
function weighted(rows: ReportRow[], value: (r: ReportRow) => number | null, weight: (r: ReportRow) => number | null = (r) => r.test.milk_kg): number | null {
  let sum = 0
  let w = 0
  for (const r of rows) {
    const v = value(r)
    const g = weight(r)
    if (v == null || g == null) continue
    sum += v * g
    w += g
  }
  return w ? sum / w : null
}

export interface ReportSummary {
  count: number
  lactation: number | null
  dim: number | null
  milk: number | null
  sampleMilk: number | null
  fat_pct: number | null
  protein_pct: number | null
  lactose_pct: number | null
  feq: number | null
  urea: number | null
  scc: number | null
  persistency: number | null
  fatKg: number | null
  proteinKg: number | null
  fatProteinKg: number | null
  ecmKg: number | null
  stdMilk: number | null
  stdFat: number | null
  stdProtein: number | null
  totalMilk: number
  totalSampleMilk: number
  sccBelow100: number | null
  sccAbove200: number | null
}

export function summarize(rows: ReportRow[]): ReportSummary {
  const fat = weighted(rows, (r) => r.test.fat_pct)
  const protein = weighted(rows, (r) => r.test.protein_pct)
  const withScc = rows.filter((r) => r.test.cell_count != null)
  const stdWeight = (r: ReportRow) => r.standard?.milk ?? null
  return {
    count: rows.length,
    lactation: mean(rows.map((r) => r.test.lactation_number)),
    dim: mean(rows.map((r) => r.dim)),
    milk: mean(rows.map((r) => r.test.milk_kg)),
    sampleMilk: mean(rows.map((r) => r.sampleMilk)),
    fat_pct: fat,
    protein_pct: protein,
    lactose_pct: weighted(rows, (r) => r.test.lactose_pct),
    feq: fat != null && protein ? fat / protein : null,
    urea: weighted(rows, (r) => r.test.urea_mg_dl),
    scc: weighted(rows, (r) => r.test.cell_count),
    persistency: mean(rows.map((r) => r.test.sample_persistency)),
    fatKg: mean(rows.map((r) => r.fatKg)),
    proteinKg: mean(rows.map((r) => r.proteinKg)),
    fatProteinKg: mean(rows.map((r) => r.fatProteinKg)),
    ecmKg: mean(rows.map((r) => r.ecmKg)),
    stdMilk: mean(rows.map((r) => r.standard?.milk ?? null)),
    stdFat: weighted(rows, (r) => r.standard?.fat_pct ?? null, stdWeight),
    stdProtein: weighted(rows, (r) => r.standard?.protein_pct ?? null, stdWeight),
    totalMilk: rows.reduce((s, r) => s + r.test.milk_kg, 0),
    totalSampleMilk: rows.reduce((s, r) => s + (r.sampleMilk ?? 0), 0),
    sccBelow100: withScc.length ? withScc.filter((r) => r.test.cell_count! < 100).length / withScc.length : null,
    sccAbove200: withScc.length ? withScc.filter((r) => r.test.cell_count! > 200).length / withScc.length : null,
  }
}

export type LactationStage = 1 | 2 | 3

/** Laktationsabschnitt wie auf Seite 2 des Prüfberichts. */
export function stageOf(dim: number | null): LactationStage | null {
  if (dim == null) return null
  return dim < 100 ? 1 : dim <= 200 ? 2 : 3
}

export const STAGE_LABEL: Record<LactationStage, string> = {
  1: '< 100 Laktationstage',
  2: '100 – 200 Laktationstage',
  3: '> 200 Laktationstage',
}
