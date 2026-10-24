import { describe, expect, it } from 'vitest'
import { shiftId } from './duty'
import { addMonths, confirmDeadline, planWeek, templateOn, templateSlotId, weekNoOn, weekStates } from './dutyPlan'
import type { DutyAbsence, DutyPerson, DutyShift, DutySkill, DutyTemplate, DutyTemplateSlot, DutyType } from '../types'

const T1 = 'a0000000-0000-4000-8000-000000000001'
const ANNA = 'b0000000-0000-4000-8000-000000000001'
const BEAT = 'b0000000-0000-4000-8000-000000000002'
const CARLA = 'b0000000-0000-4000-8000-000000000003'

const type = (extra: Partial<DutyType> = {}): DutyType => ({
  id: T1, name: 'Melken morgens', animal: 'Kühe', start_time: '06:00', duration_min: 90, weekdays: '1111111', color: null, description: null, active: true,
  sort_order: 1, updated_at: '', deleted_at: null, active_from: null, active_to: null, summer_from: null, summer_to: null, times: null, ...extra,
})
const person = (id: string, name: string, sort = 0): DutyPerson => ({ id, name, email: null, color: null, active: true, sort_order: sort, notes: null, updated_at: '', deleted_at: null })
const skill = (p: string): DutySkill => ({ id: `s${p}`, person_id: p, type_id: T1, updated_at: '', deleted_at: null })
const tpl = (id: string, valid_from: string, cycle = 1): DutyTemplate => ({ id, name: id, valid_from, cycle_weeks: cycle, notes: null, updated_at: '', deleted_at: null })
const tslot = (template_id: string, weekday: number, person_id: string | null, week_no = 0): DutyTemplateSlot => ({
  id: templateSlotId(template_id, week_no, weekday, T1, 0), template_id, week_no, weekday, type_id: T1, slot: 0, person_id, updated_at: '', deleted_at: null,
})
const absence = (person_id: string, from: string, to: string): DutyAbsence => ({ id: `a${person_id}${from}`, person_id, from_date: from, to_date: to, kind: 'ferien', notes: null, created_by: null, updated_at: '', deleted_at: null })

const MONDAY = '2026-11-02'
const base = { monday: MONDAY, types: [type()], people: [person(ANNA, 'Anna', 1), person(BEAT, 'Beat', 2), person(CARLA, 'Carla', 3)], skills: [skill(ANNA), skill(BEAT), skill(CARLA)], shifts: [] as DutyShift[], absences: [] as DutyAbsence[] }

describe('templateOn / weekNoOn', () => {
  const a = tpl('alt', '2026-01-01')
  const b = tpl('neu', '2026-11-04') // ab Mittwoch
  it('gilt ab dem Datum, die alte Version bleibt davor', () => {
    expect(templateOn([a, b], '2026-11-03')?.id).toBe('alt')
    expect(templateOn([a, b], '2026-11-04')?.id).toBe('neu')
    expect(templateOn([a, b], '2025-12-31')).toBeNull()
  })
  it('gelöschte Versionen zählen nicht', () => {
    expect(templateOn([a, { ...b, deleted_at: 'x' }], '2026-12-01')?.id).toBe('alt')
  })
  it('Rotation über mehrere Wochen', () => {
    const rot = tpl('rot', '2026-11-02', 2)
    expect([0, 7, 14, 21].map((d) => weekNoOn(rot, `2026-11-${String(2 + d).padStart(2, '0')}`).toString())).toEqual(['0', '1', '0', '1'])
    expect(weekNoOn(tpl('x', '2026-11-02', 1), '2027-03-01')).toBe(0)
  })
})

describe('planWeek', () => {
  const t = tpl('t', '2026-01-01')
  const slots = [tslot('t', 0, ANNA), tslot('t', 1, BEAT)]
  it('übernimmt die Vorlage', () => {
    const r = planWeek({ ...base, templates: [t], templateSlots: slots })
    expect(r.assignments.map((a) => [a.slot.date, a.personId, a.note])).toEqual([
      ['2026-11-02', ANNA, null],
      ['2026-11-03', BEAT, null],
    ])
  })
  it('Abwesende wird ersetzt, mit Hinweis; Ersatz ist die am wenigsten belastete Person', () => {
    const r = planWeek({ ...base, templates: [t], templateSlots: slots, absences: [absence(ANNA, '2026-11-02', '2026-11-04')] })
    const mo = r.assignments.find((a) => a.slot.date === '2026-11-02')!
    expect(mo.personId).toBe(CARLA) // Beat hat schon den Dienstag
    expect(mo.note).toBe('Ersatz für Anna (Ferien)')
  })
  it('niemand frei: bleibt offen und wird gemeldet', () => {
    const r = planWeek({
      ...base, templates: [t], templateSlots: slots,
      absences: [absence(ANNA, '2026-11-02', '2026-11-02'), absence(BEAT, '2026-11-02', '2026-11-02'), absence(CARLA, '2026-11-02', '2026-11-02')],
    })
    expect(r.assignments.find((a) => a.slot.date === '2026-11-02')).toBeUndefined()
    expect(r.unfilled[0]).toContain('Anna Ferien, niemand frei')
  })
  it('bestehende Einträge bleiben unberührt', () => {
    const existing: DutyShift = { id: shiftId(T1, '2026-11-02', 0), type_id: T1, date: '2026-11-02', slot: 0, person_id: CARLA, notes: null, assigned_by: 'x', updated_at: '', deleted_at: null }
    const r = planWeek({ ...base, templates: [t], templateSlots: slots, shifts: [existing] })
    expect(r.assignments.map((a) => a.slot.date)).toEqual(['2026-11-03'])
  })
  it('Anpassen: eingeteilte, inzwischen abwesende Person wird ersetzt', () => {
    const existing: DutyShift = { id: shiftId(T1, '2026-11-02', 0), type_id: T1, date: '2026-11-02', slot: 0, person_id: ANNA, notes: null, assigned_by: 'x', updated_at: '', deleted_at: null }
    const r = planWeek({ ...base, templates: [t], templateSlots: [], shifts: [existing], absences: [absence(ANNA, '2026-11-01', '2026-11-05')], adjustExisting: true })
    expect(r.assignments).toHaveLength(1)
    expect(r.assignments[0].personId).not.toBe(ANNA)
    expect(r.assignments[0].note).toBe('Ersatz für Anna (Ferien)')
  })
  it('Versionswechsel mitten in der Woche', () => {
    const neu = tpl('neu', '2026-11-04')
    const r = planWeek({ ...base, templates: [t, neu], templateSlots: [tslot('t', 0, ANNA), tslot('t', 2, ANNA), tslot('neu', 2, BEAT)] })
    expect(r.assignments.map((a) => [a.slot.date, a.personId])).toEqual([
      ['2026-11-02', ANNA],
      ['2026-11-04', BEAT],
    ])
  })
})

describe('Frist', () => {
  it('2 Kalendermonate im Voraus', () => {
    expect(addMonths('2026-10-24', 2)).toBe('2026-12-24')
    expect(addMonths('2026-12-31', 2)).toBe('2027-02-28')
    expect(addMonths('2026-12-31', 14)).toBe('2028-02-29')
    expect(confirmDeadline('2026-10-24')).toBe('2026-12-24')
  })
  it('Wochenstatus: überfällig innerhalb der Frist, danach noch Zeit', () => {
    const w = (week_start: string, status: 'entwurf' | 'bestaetigt') => ({ week_start, status, deleted_at: null })
    const st = weekStates([w('2026-10-19', 'bestaetigt'), w('2026-10-26', 'entwurf'), w('2027-01-04', 'entwurf')], '2026-10-24', 16)
    const by = Object.fromEntries(st.map((s) => [s.monday, s]))
    expect(by['2026-10-19'].status).toBe('bestaetigt')
    expect(by['2026-10-19'].overdue).toBe(false)
    expect(by['2026-10-26'].overdue).toBe(true)
    expect(by['2026-11-02'].status).toBe('fehlt')
    expect(by['2026-11-02'].overdue).toBe(true)
    expect(by['2027-01-04'].upcoming).toBe(true)
    expect(by['2027-01-04'].overdue).toBe(false)
  })
})
