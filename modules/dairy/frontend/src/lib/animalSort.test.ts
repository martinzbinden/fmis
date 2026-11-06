import { describe, expect, it } from 'vitest'
import { sortAnimals } from './animalSort'

const a = (id: string, lauf_nr: string | null, ear_tag: string, birth_date: string | null = null) => ({ id, lauf_nr, ear_tag, birth_date })

describe('Tiere sortieren', () => {
  it('Laufnummer numerisch, ohne Laufnummer ans Ende', () => {
    const list = [a('x', null, 'CH90000170'), a('b', '101', 'CH90000130'), a('c', '23', 'CH1'), a('d', '1001', 'CH2')]
    expect(sortAnimals(list, undefined, 'nr').map((t) => t.id)).toEqual(['c', 'b', 'd', 'x'])
  })
  it('jüngste zuerst, ohne Geburtsdatum ans Ende', () => {
    const list = [a('alt', '1', 'CH1', '2020-01-01'), a('neu', '2', 'CH2', '2026-10-21'), a('?', '3', 'CH3')]
    expect(sortAnimals(list, undefined, 'jung').map((t) => t.id)).toEqual(['neu', 'alt', '?'])
  })
})
