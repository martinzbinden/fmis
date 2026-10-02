import { describe, expect, it } from 'vitest'
import { buildReport, ecm, stageOf, summarize, testDates, type ReportTest } from './testReport'

const test = (animal_id: string, test_date: string, extra: Partial<ReportTest> = {}): ReportTest => ({
  animal_id,
  test_date,
  calving_date: '2026-08-16',
  lactation_number: 1,
  milk_kg: 20,
  fat_pct: 4,
  protein_pct: 3.2,
  lactose_pct: 4.8,
  cell_count: 50,
  urea_mg_dl: 20,
  milk_morning_kg: null,
  milk_evening_kg: 10,
  sample_persistency: 100,
  bhb_mmol: null,
  acetone_mmol: null,
  ...extra,
})

const animals = [
  { id: 'a', ear_tag: 'CH120163915453', name: 'NEUCHATEL', lauf_nr: null },
  { id: 'b', ear_tag: 'CH120136152533', name: 'ALMA', lauf_nr: null },
]

describe('testReport', () => {
  it('rechnet ECM wie die Laktationsansicht', () => {
    // 21.5 kg, 4.33 % Fett, 3.30 % Eiweiss (NEUCHATEL auf dem Papierbericht)
    expect(ecm(21.5, 4.33, 3.3)).toBe(22.3)
  })

  it('listet Kontrolltage absteigend mit Anzahl', () => {
    expect(testDates([test('a', '2026-08-24'), test('a', '2026-09-22'), test('b', '2026-09-22')])).toEqual([
      { date: '2026-09-22', count: 2 },
      { date: '2026-08-24', count: 1 },
    ])
  })

  it('baut Zeilen mit Vorprobe, Laktationstagen, Kennzahlen und Deckdatum', () => {
    const tests = [
      test('a', '2026-08-24', { cell_count: 72 }),
      test('a', '2026-09-22', { milk_kg: 21.5, fat_pct: 4.33, protein_pct: 3.3, cell_count: 19 }),
      test('b', '2026-09-22', { calving_date: '2026-07-10', lactation_number: 8 }),
    ]
    const lactations = [
      { animal_id: 'a', lactation_number: 1, closure_type: 8, days_in_milk: 54, milk_kg: 1015, fat_pct: 4.24, protein_pct: 3.35, cell_count: 30, persistency: null },
      { animal_id: 'b', lactation_number: 8, closure_type: 9, days_in_milk: 305, milk_kg: 5406, fat_pct: 3.74, protein_pct: 3.61, cell_count: null, persistency: 90 },
    ]
    const services = [
      { animal_id: 'a', service_date: '2026-05-01' }, // vor der Abkalbung → zählt nicht
      { animal_id: 'b', service_date: '2026-09-01' },
    ]
    const rows = buildReport('2026-09-22', animals, tests, lactations, services)
    // jüngste Abkalbung zuerst
    expect(rows.map((r) => r.animal.name)).toEqual(['NEUCHATEL', 'ALMA'])
    const [a, b] = rows
    expect(a.dim).toBe(37)
    expect(a.sccPrevious).toBe(72)
    expect(a.fatKg).toBe(0.93)
    expect(a.proteinKg).toBe(0.71)
    expect(a.fatProteinKg).toBe(1.64)
    expect(a.feq).toBe(1.31)
    expect(a.current?.days).toBe(54)
    expect(a.lastService).toBeNull()
    expect(b.standard).toMatchObject({ milk: 5406, projected: true, persistency: 90 })
    expect(b.lastService).toBe('2026-09-01')
    expect(b.sccPrevious).toBeNull()
  })

  it('zeigt den laufenden Laktationsstand nur bei der neuesten Probe', () => {
    const tests = [test('a', '2026-08-24'), test('a', '2026-09-22')]
    const lactations = [
      { animal_id: 'a', lactation_number: 1, closure_type: 8, days_in_milk: 54, milk_kg: 1015, fat_pct: 4, protein_pct: 3, cell_count: 30, persistency: null },
    ]
    expect(buildReport('2026-08-24', animals, tests, lactations, [])[0].current).toBeNull()
    expect(buildReport('2026-09-22', animals, tests, lactations, [])[0].current).not.toBeNull()
  })

  it('mittelt Gehalte nach Milchmenge, Mengen einfach', () => {
    const tests = [
      test('a', '2026-09-22', { milk_kg: 30, fat_pct: 4, cell_count: 100 }),
      test('b', '2026-09-22', { milk_kg: 10, fat_pct: 6, cell_count: 300 }),
    ]
    const s = summarize(buildReport('2026-09-22', animals, tests, [], []))
    expect(s.milk).toBe(20)
    expect(s.fat_pct).toBeCloseTo(4.5)
    expect(s.scc).toBeCloseTo(150)
    expect(s.totalMilk).toBe(40)
    expect(s.sccBelow100).toBe(0)
    expect(s.sccAbove200).toBe(0.5)
  })

  it('teilt Laktationsabschnitte wie Seite 2 ein', () => {
    expect(stageOf(37)).toBe(1)
    expect(stageOf(100)).toBe(2)
    expect(stageOf(200)).toBe(2)
    expect(stageOf(201)).toBe(3)
    expect(stageOf(null)).toBeNull()
  })
})
