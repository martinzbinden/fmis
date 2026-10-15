import { describe, expect, it } from 'vitest'
import { conflictsFor, copyFromPrevious, endTime, isoWeek, mondayOf, shiftId, slotsFor, slotsOn, suggest, weekDates } from './duty'
import type { DutyAbsence, DutyPerson, DutyShift, DutySkill, DutyType } from '../types'

const T = (id: string, name: string, start: string, dur: number, weekdays = '1111111'): DutyType => ({
  id, name, start_time: start, duration_min: dur, weekdays, color: null, description: null, active: true, sort_order: 0, updated_at: '', deleted_at: null,
})
const P = (id: string, name: string): DutyPerson => ({ id, name, email: null, color: null, active: true, sort_order: 0, notes: null, updated_at: '', deleted_at: null })
const S = (person: string, type: string): DutySkill => ({ id: `${person}${type}`, person_id: person, type_id: type, updated_at: '', deleted_at: null })
const kuehe = T('k', 'Melken Kühe morgens', '06:00', 90)
const schafe = T('s', 'Melken Schafe morgens', '06:00', 75)
const kaeserei = T('c', 'Schafmilch Käserei', '07:30', 60, '0100100')

describe('Wochen', () => {
  it('Montag, Tage, KW', () => {
    expect(mondayOf('2026-10-16')).toBe('2026-10-12')
    expect(weekDates('2026-10-12')).toHaveLength(7)
    expect(isoWeek('2026-10-16')).toBe(42)
    expect(isoWeek('2026-01-01')).toBe(1)
    expect(isoWeek('2027-01-01')).toBe(53)
  })
  it('Plätze je Wochentag, Ende', () => {
    expect(slotsOn(kaeserei, '2026-10-13')).toBe(1) // Di
    expect(slotsOn(kaeserei, '2026-10-14')).toBe(0) // Mi
    expect(slotsOn({ ...kaeserei, active: false }, '2026-10-13')).toBe(0)
    expect(endTime(kuehe)).toBe('07:30')
    expect(shiftId('k', '2026-10-13', 0)).toBe(shiftId('k', '2026-10-13', 0))
    expect(shiftId('k', '2026-10-13', 0)).not.toBe(shiftId('k', '2026-10-13', 1))
  })
})

describe('Konflikte und Vorschlag', () => {
  const people = [P('a', 'Anna'), P('b', 'Beat')]
  const skills = [S('a', 'k'), S('a', 's'), S('b', 'k'), S('b', 's'), S('b', 'c')]
  const absences: DutyAbsence[] = [{ id: 'x', person_id: 'b', from_date: '2026-10-15', to_date: '2026-10-16', kind: 'ferien', notes: null, created_by: null, updated_at: '', deleted_at: null }]
  const dates = weekDates('2026-10-12')
  it('gleichzeitig, abwesend, nicht befähigt', () => {
    const shift: DutyShift = { id: shiftId('k', '2026-10-12', 0), type_id: 'k', date: '2026-10-12', slot: 0, person_id: 'a', notes: null, assigned_by: null, updated_at: '', deleted_at: null }
    const slots = slotsFor([kuehe, schafe, kaeserei], [shift], dates)
    const schafMo = slots.find((s) => s.type.id === 's' && s.date === '2026-10-12')!
    expect(conflictsFor('a', schafMo, slots, skills, absences).overlap).toEqual(['Melken Kühe morgens'])
    const kaeDo = slotsFor([kaeserei], [], ['2026-10-16'])[0]
    expect(conflictsFor('b', kaeDo, slots, skills, absences).absent?.kind).toBe('ferien')
    expect(conflictsFor('a', kaeDo, slots, skills, absences).unskilled).toBe(true)
  })
  it('Vorschlag: keine Überschneidung, Abwesenheit beachtet, gleichmässig', () => {
    const slots = slotsFor([kuehe, schafe, kaeserei], [], dates)
    const sug = suggest(slots, people, skills, absences)
    // Do/Fr ist Beat weg: Kühe und Schafe gleichzeitig nur durch Anna → ein Platz bleibt offen
    const fr = sug.filter((x) => x.slot.date === '2026-10-16')
    expect(fr.map((x) => x.personId)).toEqual(['a'])
    // Käserei Fr: niemand (Beat abwesend, Anna kann es nicht)
    expect(sug.some((x) => x.slot.type.id === 'c' && x.slot.date === '2026-10-16')).toBe(false)
    // Mo: beide eingeteilt, nicht dieselbe Person gleichzeitig
    const mo = sug.filter((x) => x.slot.date === '2026-10-12' && x.slot.type.start_time === '06:00')
    expect(new Set(mo.map((x) => x.personId)).size).toBe(2)
    // zurückgegeben werden die offenen Plätze (sonst überspringt das Speichern sie)
    expect(sug.every((x) => x.slot.shift === null)).toBe(true)
  })
  it('Vorwoche übernehmen', () => {
    const prevDates = weekDates('2026-10-05')
    const prevShifts: DutyShift[] = prevDates.map((d) => ({ id: shiftId('k', d, 0), type_id: 'k', date: d, slot: 0, person_id: 'b', notes: null, assigned_by: null, updated_at: '', deleted_at: null }))
    const prev = slotsFor([kuehe], prevShifts, prevDates)
    const now = slotsFor([kuehe], [], dates)
    const res = copyFromPrevious(now, prev, skills, absences)
    expect(res.map((r) => r.slot.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-17', '2026-10-18'])
    expect(res.every((r) => r.slot.shift === null)).toBe(true)
  })
})
