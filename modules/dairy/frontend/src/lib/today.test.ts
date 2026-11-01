import { describe, expect, it } from 'vitest'
import { expectedBirths } from './today'

const a = (id: string) => ({ id, ear_tag: `CH0000000${id}`, lauf_nr: id, name: null })

describe('expectedBirths', () => {
  it('Belegung + Tragzeit, ohne Geborene und «leer» Untersuchte', () => {
    const out = expectedBirths(
      {
        animals: [a('1'), a('2'), a('3'), a('4')],
        matings: [
          { animal_id: '1', service_date: '2026-06-10', service_to: '2026-06-20' }, // 7.–17.11.
          { animal_id: '2', service_date: '2026-06-05', service_to: null }, // schon geboren
          { animal_id: '3', service_date: '2026-06-05', service_to: null }, // leer
          { animal_id: '4', service_date: '2026-08-01', service_to: null }, // zu weit weg
        ],
        births: [{ dam_id: '2', birth_date: '2026-10-30' }],
        checks: [{ animal_id: '3', check_date: '2026-08-01', result: 'nein' }],
      },
      'sheep',
      '2026-11-01',
    )
    expect(out.map((e) => [e.animal.id, e.from, e.to])).toEqual([['1', '2026-11-07', '2026-11-17']])
  })

  it('überfällige bleiben 14 Tage stehen', () => {
    const input = { animals: [a('1')], matings: [{ animal_id: '1', service_date: '2026-05-25', service_to: null }], births: [], checks: [] }
    expect(expectedBirths(input, 'sheep', '2026-11-01')).toHaveLength(1) // 22.10.
    expect(expectedBirths(input, 'sheep', '2026-11-10')).toHaveLength(0)
  })
})
