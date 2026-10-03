import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTER, fePerDay, groupByAnimal, matchesLactation, sortAnimals, sortRows, type LactationRow } from './lactationView'

let seq = 0
function lact(animal: string, nr: number, fe: number | null, closure = 1, extra: Partial<LactationRow> = {}): LactationRow {
  return {
    lactation_id: `l${++seq}`,
    animal_id: animal,
    ear_tag: `CH113${animal.padStart(9, '0')}`,
    name: null,
    lactation_number: nr,
    calving_date: `${2020 + nr}-02-01`,
    closure_type: closure as LactationRow['closure_type'],
    days_in_milk: 200,
    milk_kg: 400,
    fat_kg: fe == null ? null : fe / 2,
    fat_pct: 6,
    protein_kg: fe == null ? null : fe / 2,
    protein_pct: 5.5,
    fat_protein_kg: fe,
    lauf_nr: animal === '1' ? '2212' : animal === '2' ? '1910' : null,
    animal_status: 'aktiv',
    ...extra,
  }
}

const rows = [lact('1', 1, 50), lact('1', 2, 70), lact('1', 3, 30, 8), lact('2', 1, 55), lact('3', 1, null, 1, { animal_status: 'abgegangen' })]

describe('lactationView', () => {
  it('filtert nach Status, Laktation, Jahr, Suche und aktiven Tieren', () => {
    const f = (p: Partial<typeof DEFAULT_FILTER>) => rows.filter((r) => matchesLactation(r, { ...DEFAULT_FILTER, ...p })).length
    expect(f({})).toBe(4)
    expect(f({ activeOnly: false })).toBe(5)
    expect(f({ status: 'laufend' })).toBe(1)
    expect(f({ parity: '1' })).toBe(2)
    expect(f({ parity: '3+' })).toBe(1)
    expect(f({ year: '2022' })).toBe(1)
    expect(f({ search: '2212' })).toBe(3)
  })

  it('fasst je Tier zusammen: Ø nur über abgeschlossene', () => {
    const [a] = groupByAnimal(rows.filter((r) => r.animal_id === '1'))
    expect(a.latest.lactation_number).toBe(3)
    expect(a.avgFe).toBe(60)
    expect(a.totalFe).toBe(150)
    expect(a.bestFe).toBe(70)
  })

  it('sortiert Tiere nach Laufnummer bzw. Leistung, fehlende Werte zuletzt', () => {
    const animals = groupByAnimal(rows)
    expect(sortAnimals(animals, 'lauf_nr').map((a) => a.lauf_nr)).toEqual(['1910', '2212', null])
    expect(sortAnimals(animals, 'avg_fe').map((a) => a.animal_id)).toEqual(['1', '2', '3'])
    expect(sortAnimals(animals, 'latest_fe').map((a) => a.animal_id)).toEqual(['2', '1', '3'])
  })

  it('sortiert alle Laktationen nach Spalte', () => {
    expect(sortRows(rows, 'fat_protein_kg', true).map((r) => r.fat_protein_kg)).toEqual([70, 55, 50, 30, null])
    expect(fePerDay(rows[0])).toBe(250)
  })
})
