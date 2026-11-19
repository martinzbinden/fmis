import { describe, expect, it } from 'vitest'
import { absenceUnits, dayOfYear, daysInYear, overlaps, planEntries, vacationDays } from './vacationPlan'
import type { DutyAbsence, DutyRequest } from '../types'

const abs = (person_id: string, from_date: string, to_date: string, kind: DutyAbsence['kind'] = 'ferien'): DutyAbsence =>
  ({ id: `${person_id}${from_date}`, person_id, from_date, to_date, kind, notes: null, created_by: null, updated_at: '', deleted_at: null, source: null, import_key: null, missing_since: null }) as DutyAbsence
const wish = (person_id: string, from_date: string, to_date: string): DutyRequest =>
  ({ id: `w${person_id}`, kind: 'wunsch', person_id, from_date, to_date, status: 'offen', absence_kind: 'kurs', deleted_at: null, notes: 'unsicher' }) as DutyRequest

describe('Ferienplan', () => {
  it('Einträge auf das Jahr gekürzt, Wünsche markiert', () => {
    const e = planEntries([abs('a', '2026-12-28', '2027-01-03'), abs('b', '2026-05-01', '2026-05-02')], [wish('c', '2027-06-01', '2027-06-30')], 2027)
    expect(e).toEqual([
      { personId: 'a', from: '2027-01-01', to: '2027-01-03', kind: 'ferien', pending: false, notes: null },
      { personId: 'c', from: '2027-06-01', to: '2027-06-30', kind: 'kurs', pending: true, notes: 'unsicher' },
    ])
  })

  it('Überschneidungen als Zeiträume mit gleicher Besetzung', () => {
    const e = planEntries([abs('a', '2027-03-01', '2027-03-07'), abs('b', '2027-03-01', '2027-03-05', 'kurs'), abs('c', '2027-03-05', '2027-03-06', 'schule')], [], 2027)
    expect(overlaps(e).map((o) => [o.from, o.to, o.who.map((w) => w.personId).join('')])).toEqual([
      ['2027-03-01', '2027-03-04', 'ab'],
      ['2027-03-05', '2027-03-05', 'abc'],
      ['2027-03-06', '2027-03-06', 'ac'],
    ])
    expect(overlaps(e, { withSchool: false }).map((o) => [o.from, o.to])).toEqual([['2027-03-01', '2027-03-05']])
  })

  it('Ferien gehen vor dem Schultag derselben Person', () => {
    const e = planEntries([abs('a', '2027-03-01', '2027-03-01', 'schule'), abs('a', '2027-03-01', '2027-03-07'), abs('b', '2027-03-01', '2027-03-01', 'kurs')], [], 2027)
    expect(overlaps(e)[0].who.map((w) => w.kind)).toEqual(['ferien', 'kurs'])
  })

  it('gemeinsam Abwesende zählen als eine Einheit; gelöschte Personen gar nicht', () => {
    const unitOf = absenceUnits([{ id: 'a', absence_with: 'b' }, { id: 'b' }, { id: 'c' }])
    const e = planEntries([abs('a', '2027-02-20', '2027-02-28'), abs('b', '2027-02-20', '2027-02-28'), abs('c', '2027-02-27', '2027-03-02'), abs('x', '2027-02-20', '2027-02-21')], [], 2027, new Set(['a', 'b', 'c']))
    expect(overlaps(e, { unitOf }).map((o) => [o.from, o.to, o.who.length])).toEqual([['2027-02-27', '2027-02-28', 3]])
  })

  it('aneinander anschliessend ist keine Überschneidung', () => {
    const e = planEntries([abs('a', '2027-07-12', '2027-07-25'), abs('b', '2027-07-26', '2027-08-08')], [], 2027)
    expect(overlaps(e)).toEqual([])
  })

  it('Ferientage: Kalender- und Arbeitstage, Wünsche getrennt', () => {
    // Mo 1.3. bis So 7.3.2027 = 7 Tage, 5 Arbeitstage
    const e = planEntries([abs('a', '2027-03-01', '2027-03-07'), abs('a', '2027-03-06', '2027-03-08')], [], 2027)
    expect(vacationDays(e, 'a')).toEqual({ days: 8, workdays: 6, pendingDays: 0 })
  })

  it('Tag im Jahr', () => {
    expect(dayOfYear('2027-01-01')).toBe(0)
    expect(dayOfYear('2027-12-31')).toBe(364)
    expect(daysInYear(2028)).toBe(366)
  })
})
