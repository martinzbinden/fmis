import { describe, expect, it } from 'vitest'
import { buildMilkRows, sortMilkRows, summarize, type MilkTest } from './milkAmounts'

const TODAY = '2026-04-20'
const animals = [1, 2, 3, 4].map((n) => ({ id: `a${n}`, ear_tag: `CH${n}`, lauf_nr: String(n), name: null }))
const test = (id: string, date: string, kg: number, calving: string | null = '2026-02-01'): MilkTest => ({ animal_id: id, test_date: date, calving_date: calving, milk_kg: kg, fat_pct: 3.5, protein_pct: 3.2, cell_count: 100 })
const rows = (tests: MilkTest[], dry: string[] = [], bans: [string, string][] = []) => buildMilkRows({ animals, tests, dryIds: new Set(dry), bans: new Map(bans) }, TODAY)

describe('buildMilkRows', () => {
  it('nimmt die letzte Prüfung, Laktationstag und Veränderung', () => {
    const [r] = rows([test('a1', '2026-03-10', 2.4), test('a1', '2026-04-10', 2.1)])
    expect(r).toMatchObject({ kg: 2.1, testDate: '2026-04-10', testAgeDays: 10, dim: 78, delta: -0.3 })
  })
  it('Veränderung nur innerhalb derselben Laktation', () => {
    const [r] = rows([test('a1', '2026-01-10', 2.4, '2025-02-01'), test('a1', '2026-04-10', 2.1)])
    expect(r.delta).toBeNull()
  })
  it('trockene, ohne Prüfung und zu alte Prüfungen fehlen', () => {
    const r = rows([test('a1', '2026-04-10', 2), test('a2', '2026-04-10', 2), test('a3', '2025-01-01', 2)], ['a2'])
    expect(r.map((x) => x.animal.id)).toEqual(['a1'])
  })
  it('Melkverbot wird angehängt', () => {
    expect(rows([test('a1', '2026-04-10', 2)], [], [['a1', '2026-04-25']])[0].banUntil).toBe('2026-04-25')
  })
})

describe('sort und summarize', () => {
  const r = rows([test('a1', '2026-04-10', 2.0, '2026-03-01'), test('a2', '2026-04-10', 3.1, '2026-02-01'), test('a3', '2026-04-10', 1.2, '2026-01-01')], [], [['a2', '2026-04-22']])
  it('Menge, Laktationstag, Nummer', () => {
    expect(sortMilkRows(r, 'menge').map((x) => x.animal.id)).toEqual(['a2', 'a1', 'a3'])
    expect(sortMilkRows(r, 'tag').map((x) => x.animal.id)).toEqual(['a1', 'a2', 'a3'])
    expect(sortMilkRows(r, 'nummer').map((x) => x.animal.id)).toEqual(['a1', 'a2', 'a3'])
  })
  it('Summe, Mittel, gesperrte', () => {
    expect(summarize(r)).toEqual({ count: 3, sumKg: 6.3, avgKg: 2.1, banned: 1 })
    expect(summarize([])).toEqual({ count: 0, sumKg: 0, avgKg: null, banned: 0 })
  })
})
