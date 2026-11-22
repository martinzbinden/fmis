import { describe, expect, it } from 'vitest'
import { shiftId } from './duty'
import { templateSlotId } from './dutyPlan'
import { findGaps } from './dutyGaps'
import type { DutyAbsence, DutyPerson, DutyShift, DutySkill, DutyTemplate, DutyTemplateSlot, DutyType } from '../types'

const T1 = 'a0000000-0000-4000-8000-000000000001'
const ANNA = 'b0000000-0000-4000-8000-000000000001'
const BEAT = 'b0000000-0000-4000-8000-000000000002'
const CARLA = 'b0000000-0000-4000-8000-000000000003'
const type: DutyType = {
  id: T1, name: 'Melken morgens', animal: 'Kühe', start_time: '06:00', duration_min: 90, weekdays: '1111111', color: null, description: null, active: true,
  sort_order: 1, updated_at: '', deleted_at: null, active_from: null, active_to: null, summer_from: null, summer_to: null, times: null,
}
const person = (id: string, name: string, sort: number): DutyPerson => ({ id, name, email: null, color: null, active: true, sort_order: sort, notes: null, updated_at: '', deleted_at: null, school_class: null, school_half: null, companion: false })
const skill = (p: string): DutySkill => ({ id: `s${p}`, person_id: p, type_id: T1, updated_at: '', deleted_at: null })
const tpl: DutyTemplate = { id: 'std', name: 'std', valid_from: '2026-01-05', cycle_weeks: 1, notes: null, updated_at: '', deleted_at: null }
const tslot = (weekday: number, person_id: string): DutyTemplateSlot => ({ id: templateSlotId('std', 0, weekday, T1, 0), template_id: 'std', week_no: 0, weekday, type_id: T1, slot: 0, person_id, updated_at: '', deleted_at: null })
const shift = (date: string, person_id: string, notes: string | null = null): DutyShift => ({ id: shiftId(T1, date, 0), type_id: T1, date, slot: 0, person_id, notes, assigned_by: null, updated_at: '', deleted_at: null })
const ferien = (person_id: string, from: string, to: string): DutyAbsence => ({ id: `a${person_id}${from}`, person_id, from_date: from, to_date: to, kind: 'ferien', notes: null, created_by: null, updated_at: '', deleted_at: null, source: null, import_key: null, missing_since: null })

// Standardplan: Anna Mo–Mi, Beat Do–So; Carla nur als Ersatz
const templateSlots = [0, 1, 2].map((d) => tslot(d, ANNA)).concat([3, 4, 5, 6].map((d) => tslot(d, BEAT)))
const base = {
  personId: ANNA, types: [type], templates: [tpl], templateSlots,
  people: [person(ANNA, 'Anna', 1), person(BEAT, 'Beat', 2), person(CARLA, 'Carla', 3)], skills: [skill(ANNA), skill(BEAT), skill(CARLA)], fulltimeHours: 50,
}

describe('Lücken durch Abwesenheit', () => {
  it('findet eingeteilte und laut Standardplan fällige Dienste und schlägt Ersatz vor', () => {
    // Montag 2.11. schon eingeteilt (Anna), Dienstag und Mittwoch noch nicht erzeugt, Donnerstag Beat
    const gaps = findGaps({ ...base, from: '2026-11-02', to: '2026-11-05', shifts: [shift('2026-11-02', ANNA), shift('2026-11-05', BEAT)], absences: [ferien(ANNA, '2026-11-02', '2026-11-05')] })
    expect(gaps.map((g) => [g.slot.date, g.state])).toEqual([
      ['2026-11-02', 'eingeteilt'],
      ['2026-11-03', 'standard'],
      ['2026-11-04', 'standard'],
    ])
    // Carla hat sonst nichts: sie zuerst; danach gleichmässig verteilt (Beat hat nur den Donnerstag); Anna selbst nie
    expect(gaps.map((g) => g.suggestion)).toEqual([CARLA, BEAT, CARLA])
    expect(gaps[0].candidates.map((c) => c.personId)).not.toContain(ANNA)
  })

  it('ist die Ersatzperson auch weg, kommt die nächste; schon ersetzte Dienste stehen mit Ersatz da', () => {
    const gaps = findGaps({
      ...base, from: '2026-11-02', to: '2026-11-03',
      shifts: [shift('2026-11-02', BEAT, 'Ersatz für Anna (Ferien)')],
      absences: [ferien(ANNA, '2026-11-02', '2026-11-03'), ferien(CARLA, '2026-11-03', '2026-11-03')],
    })
    expect(gaps.map((g) => [g.state, g.current, g.suggestion])).toEqual([
      ['ersetzt', BEAT, BEAT],
      ['standard', null, BEAT],
    ])
    const carla = gaps[1].candidates.find((c) => c.personId === CARLA)!
    expect(carla.conflict.absent?.kind).toBe('ferien')
  })
})
