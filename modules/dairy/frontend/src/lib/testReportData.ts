// Lädt alle Daten für den Prüfbericht (pages/Pruefbericht.tsx) und wandelt
// die numeric-Spalten von pglite (kommen als string) in Zahlen.

import type { PGlite } from '@electric-sql/pglite'
import { isoDate, num } from './format'
import type { ReportAnimal, ReportLactation, ReportTest } from './testReport'

export interface TestReportData {
  animals: ReportAnimal[]
  tests: ReportTest[]
  lactations: ReportLactation[]
  services: { animal_id: string; service_date: string }[]
}

export async function loadTestReportData(pg: PGlite): Promise<TestReportData> {
  const [animals, tests, lactations, services] = await Promise.all([
    pg.query<ReportAnimal>('select id, ear_tag, name, lauf_nr from animals where deleted_at is null'),
    pg.query<Record<string, unknown>>('select * from milk_tests where deleted_at is null'),
    pg.query<Record<string, unknown>>(
      'select animal_id, lactation_number, closure_type, days_in_milk, milk_kg, fat_pct, protein_pct, cell_count, persistency from lactations where deleted_at is null',
    ),
    pg.query<{ animal_id: string; service_date: unknown }>('select animal_id, service_date from matings where deleted_at is null'),
  ])
  return {
    animals: animals.rows,
    tests: tests.rows.map((t) => ({
      animal_id: String(t.animal_id),
      test_date: isoDate(t.test_date)!,
      calving_date: isoDate(t.calving_date),
      lactation_number: num(t.lactation_number),
      milk_kg: num(t.milk_kg) ?? 0,
      fat_pct: num(t.fat_pct),
      protein_pct: num(t.protein_pct),
      lactose_pct: num(t.lactose_pct),
      cell_count: num(t.cell_count),
      urea_mg_dl: num(t.urea_mg_dl),
      milk_morning_kg: num(t.milk_morning_kg),
      milk_evening_kg: num(t.milk_evening_kg),
      sample_persistency: num(t.sample_persistency),
      bhb_mmol: num(t.bhb_mmol),
      acetone_mmol: num(t.acetone_mmol),
    })),
    lactations: lactations.rows.map((l) => ({
      animal_id: String(l.animal_id),
      lactation_number: num(l.lactation_number) ?? 0,
      closure_type: num(l.closure_type) ?? 0,
      days_in_milk: num(l.days_in_milk),
      milk_kg: num(l.milk_kg),
      fat_pct: num(l.fat_pct),
      protein_pct: num(l.protein_pct),
      cell_count: num(l.cell_count),
      persistency: num(l.persistency),
    })),
    services: services.rows.map((s) => ({ animal_id: s.animal_id, service_date: isoDate(s.service_date)! })),
  }
}
