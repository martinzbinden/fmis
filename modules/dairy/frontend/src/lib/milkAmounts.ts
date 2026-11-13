// Milchmengen im Stallkalender (pages/Stall.tsx, Fokus «Melken»): letzte Milchprüfung je melkendem Tier,
// Laktationstag, Entwicklung zur Prüfung davor und Melkverbot. Rein (testbar); das Laden steht darunter.

import type { PGlite } from '@electric-sql/pglite'
import { loadDryAnimalIds } from './dryOff'
import { daysBetween, isoDate, num } from './format'
import { lactationDayAt } from './lactationDay'
import type { TodayAnimal } from './today'

export interface MilkTest {
  animal_id: string
  test_date: string
  calving_date: string | null
  milk_kg: number
  fat_pct: number | null
  protein_pct: number | null
  cell_count: number | null
}

export interface MilkRow {
  animal: TodayAnimal
  testDate: string
  /** Tage seit der letzten Prüfung */
  testAgeDays: number
  kg: number
  fat: number | null
  protein: number | null
  cells: number | null
  /** Laktationstag heute (Abkalbetag = 0) */
  dim: number | null
  /** Veränderung in kg gegenüber der Prüfung davor (nur innerhalb derselben Laktation) */
  delta: number | null
  /** Melkverbot bis und mit */
  banUntil: string | null
}

/** Prüfungen, die länger her sind, zählen nicht mehr als aktuelle Menge. */
export const MAX_TEST_AGE_DAYS = 365

export function buildMilkRows(
  input: { animals: TodayAnimal[]; tests: MilkTest[]; dryIds: Set<string>; bans: Map<string, string> },
  today: string,
): MilkRow[] {
  const byAnimal = new Map<string, MilkTest[]>()
  for (const t of input.tests) byAnimal.set(t.animal_id, [...(byAnimal.get(t.animal_id) ?? []), t])
  const rows: MilkRow[] = []
  for (const a of input.animals) {
    if (input.dryIds.has(a.id)) continue
    const tests = (byAnimal.get(a.id) ?? []).sort((x, y) => y.test_date.localeCompare(x.test_date))
    const last = tests[0]
    if (!last) continue
    const testAgeDays = daysBetween(last.test_date, today)
    if (testAgeDays > MAX_TEST_AGE_DAYS) continue
    const prev = tests[1]
    const sameLactation = prev && (prev.calving_date ?? null) === (last.calving_date ?? null)
    rows.push({
      animal: a,
      testDate: last.test_date,
      testAgeDays,
      kg: last.milk_kg,
      fat: last.fat_pct,
      protein: last.protein_pct,
      cells: last.cell_count,
      dim: lactationDayAt(last.calving_date, today),
      delta: sameLactation ? Math.round((last.milk_kg - prev.milk_kg) * 10) / 10 : null,
      banUntil: input.bans.get(a.id) ?? null,
    })
  }
  return rows
}

export type MilkSort = 'menge' | 'tag' | 'nummer'

export function sortMilkRows(rows: MilkRow[], by: MilkSort): MilkRow[] {
  const num2 = (r: MilkRow) => r.animal.lauf_nr ?? r.animal.ear_tag
  const cmp: Record<MilkSort, (a: MilkRow, b: MilkRow) => number> = {
    menge: (a, b) => b.kg - a.kg,
    tag: (a, b) => (a.dim ?? 9999) - (b.dim ?? 9999),
    nummer: (a, b) => num2(a).localeCompare(num2(b), 'de', { numeric: true }),
  }
  return [...rows].sort((a, b) => cmp[by](a, b) || num2(a).localeCompare(num2(b), 'de', { numeric: true }))
}

export interface MilkSummary {
  count: number
  sumKg: number
  avgKg: number | null
  banned: number
}

export function summarize(rows: MilkRow[]): MilkSummary {
  const sumKg = Math.round(rows.reduce((s, r) => s + r.kg, 0) * 10) / 10
  return { count: rows.length, sumKg, avgKg: rows.length ? Math.round((sumKg / rows.length) * 10) / 10 : null, banned: rows.filter((r) => r.banUntil).length }
}

/** Ohne Melkverbot (banUntil null): das setzt die Seite aus den Absetzfristen dazu, damit die Abfrage nicht neu läuft, wenn sich diese ändern. */
export async function loadMilk(pg: PGlite, today: string): Promise<MilkRow[]> {
  const [animals, tests, dryIds] = await Promise.all([
    pg.query<TodayAnimal>(`select id, ear_tag, lauf_nr, name from animals where deleted_at is null and status = 'aktiv' and sex = 'w'`),
    pg.query<Record<string, unknown>>(
      `select animal_id, test_date, calving_date, milk_kg, fat_pct, protein_pct, cell_count from (
         select mt.*, row_number() over (partition by mt.animal_id order by mt.test_date desc) as rn
         from milk_tests mt where mt.deleted_at is null
       ) t where rn <= 2`,
    ),
    loadDryAnimalIds(pg),
  ])
  return buildMilkRows(
    {
      animals: animals.rows,
      tests: tests.rows.map((t) => ({
        animal_id: String(t.animal_id),
        test_date: isoDate(t.test_date)!,
        calving_date: isoDate(t.calving_date) ?? null,
        milk_kg: num(t.milk_kg) ?? 0,
        fat_pct: num(t.fat_pct),
        protein_pct: num(t.protein_pct),
        cell_count: num(t.cell_count),
      })),
      dryIds,
      bans: new Map(),
    },
    today,
  )
}
