import { describe, expect, it } from 'vitest'
import { checkDuty, type DutyPasteValue } from './pasteDuty'
import { shiftId } from './duty'
import type { DutyPerson, DutyShift, DutyType } from '../types'

const T = (id: string, animal: string, name: string, start: string, weekdays = '1111111', active = true): DutyType => ({
  id, name, start_time: start, duration_min: 90, weekdays, color: null, description: null, active, sort_order: 0, updated_at: '', deleted_at: null,
  animal, active_from: null, active_to: null, summer_from: null, summer_to: null, times: null,
})
const P = (id: string, name: string): DutyPerson => ({ id, name, email: null, color: null, active: true, sort_order: 0, notes: null, updated_at: '', deleted_at: null, school_class: null, school_half: null })
const types = [
  T('km', 'Kühe', 'Melken morgens', '06:00'),
  T('ka', 'Kühe', 'Melken abends', '17:00'),
  T('sm', 'Schafe', 'Melken morgens', '06:00'),
  T('sa', 'Schafe', 'Melken abends', '17:00', '1111111', false),
  T('sc', 'Schafe', 'Milch zur Käserei', '07:30', '0100100'),
]
const people = [P('a', 'Anna Muster'), P('m', 'Zbinden Martin')]
const shift = (type_id: string, date: string, person_id: string): DutyShift => ({ id: shiftId(type_id, date, 0), type_id, date, slot: 0, person_id, notes: null, assigned_by: null, updated_at: '', deleted_at: null })
const v = (r: { value: unknown }) => r.value as DutyPasteValue

describe('Dienstplan einfügen', () => {
  it('Tierart = alle Dienste des Tages, teil morgens/abends', () => {
    const [kuehe, morgens, abends, schafeFr] = checkDuty(
      [
        { datum: '2026-11-08', person: 'Anna', dienst: 'Kühe', hilfe: 'M+M' },
        { datum: '2026-11-07', person: 'F+V', dienst: 'Kühe', teil: 'morgens' },
        { datum: '2026-11-07', person: 'M+M', dienst: 'kühe', teil: 'abends' },
        { datum: '2026-12-25', person: 'M+M', dienst: 'Schafe' },
      ],
      people, types, [],
    )
    expect(kuehe.status).toBe('neu')
    expect(v(kuehe).personId).toBe('a')
    expect(v(kuehe).slots.map((s) => s.type_id)).toEqual(['km', 'ka'])
    expect(v(kuehe).note).toBe('Hilfe: M+M')
    expect(v(morgens).slots.map((s) => s.type_id)).toEqual(['km'])
    expect(morgens.warnings.join()).toContain('ohne Konto')
    expect(v(abends).slots.map((s) => s.type_id)).toEqual(['ka'])
    // Freitag: Käserei dazu, Schafe abends ist inaktiv
    expect(v(schafeFr).slots.map((s) => s.type_id)).toEqual(['sm', 'sc'])
  })
  it('überschreibt keine besetzten Plätze und erkennt Doppeltes', () => {
    const shifts = [shift('km', '2026-11-08', 'm'), shift('sm', '2026-11-14', 'a')]
    const [busy, same, twice1, twice2, none] = checkDuty(
      [
        { datum: '2026-11-08', person: 'Anna', dienst: 'Kühe' },
        { datum: '2026-11-14', person: 'Anna Muster', dienst: 'Schafe' },
        { datum: '2026-11-15', person: 'Eymann', dienst: 'Schafe' },
        { datum: '2026-11-15', person: 'F+V', dienst: 'Schafe' },
        { datum: '2026-11-15', person: 'Eymann', dienst: 'Hühner' },
      ],
      people, types, shifts,
    )
    expect(busy.status).toBe('fehler')
    expect(busy.problems.join()).toContain('Zbinden Martin')
    expect(same.status).toBe('doppelt')
    expect(twice1.status).toBe('neu')
    expect(twice2.status).toBe('fehler')
    expect(twice2.problems.join()).toContain('Datensatz 3')
    expect(none.status).toBe('fehler')
  })
})
