import { describe, expect, it } from 'vitest'
import { checkAbsences } from './pasteAbsences'
import type { DutyAbsence, DutyPerson } from '../types'

const person = (id: string, name: string) => ({ id, name, active: true, deleted_at: null, sort_order: 1 }) as DutyPerson
const people = [person('a', 'Anna Test'), person('b', 'Beat Muster'), person('c', 'Carla Muster')]

describe('Abwesenheiten einfügen', () => {
  it('ordnet Namen zu, «A+B» trägt beide ein, unsicher wird Wunsch', () => {
    const r = checkAbsences(
      [
        { person: 'Anna', von: '2027-03-01', bis: '2027-03-07' },
        { person: 'Beat+Carla', von: '2027-02-20', bis: '2027-02-28' },
        { person: 'Anna', von: '2027-06-01', bis: '2027-06-30', art: 'kurs', unsicher: 'ja' },
      ],
      people,
      [],
      [],
    )
    expect(r.map((x) => x.status)).toEqual(['neu', 'neu', 'neu'])
    expect((r[1].value as { persons: { id: string }[] }).persons.map((p) => p.id)).toEqual(['b', 'c'])
    expect(r[2].value).toMatchObject({ kind: 'kurs', pending: true })
  })

  it('mehrdeutig, falsche Art und «bis» vor «von» sind Fehler', () => {
    const r = checkAbsences(
      [
        { person: 'Muster', von: '2027-03-01' },
        { person: 'Anna', von: '2027-03-01', art: 'schlafen' },
        { person: 'Anna', von: '2027-03-05', bis: '2027-03-01' },
      ],
      people,
      [],
      [],
    )
    expect(r.map((x) => x.status)).toEqual(['fehler', 'fehler', 'fehler'])
  })

  it('schon eingetragen = doppelt; unbekannte Person wird angelegt (Warnung)', () => {
    const a = { id: 'x', person_id: 'a', from_date: '2027-03-01', to_date: '2027-03-07', kind: 'ferien', deleted_at: null } as DutyAbsence
    const r = checkAbsences([{ person: 'Anna', von: '2027-03-01', bis: '2027-03-07' }, { person: 'Dora', von: '2027-04-01' }], people, [a], [])
    expect(r[0].status).toBe('doppelt')
    expect(r[1].status).toBe('neu')
    expect(r[1].value).toMatchObject({ persons: [{ id: null, name: 'Dora' }], to: '2027-04-01' })
  })
})
