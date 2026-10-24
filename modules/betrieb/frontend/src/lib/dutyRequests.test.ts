import { describe, expect, it } from 'vitest'
import { checkRequest, slotById, type DutyData } from './dutyData'
import { shiftId } from './duty'
import type { DutyPerson, DutyRequest, DutyShift, DutyType } from '../types'

const T1 = '10000000-0000-4000-8000-000000000001'
const ANNA = 'a0000000-0000-4000-8000-000000000001'
const BEAT = 'a0000000-0000-4000-8000-000000000002'

const type = { id: T1, name: 'Melken', start_time: '06:00', duration_min: 60, weekdays: '1111111', active: true, color: null, description: null, sort_order: 1, updated_at: '', deleted_at: null } as DutyType
const person = (id: string, name: string) => ({ id, name, email: null, color: null, active: true, sort_order: 1, notes: null, updated_at: '', deleted_at: null }) as DutyPerson
const shift = (date: string, person_id: string | null): DutyShift => ({ id: shiftId(T1, date, 0), type_id: T1, date, slot: 0, person_id, notes: null, assigned_by: null, updated_at: '', deleted_at: null })
const data = (shifts: DutyShift[]): DutyData => ({ people: [person(ANNA, 'Anna'), person(BEAT, 'Beat')], types: [type], skills: [], absences: [], shifts, changes: [], requests: [], templates: [], templateSlots: [], weeks: [] })
const req = (r: Partial<DutyRequest>): DutyRequest => ({
  id: 'r1', kind: 'abgabe', person_id: ANNA, shift_id: shiftId(T1, '2026-11-03', 0), date: '2026-11-03', type_id: T1, to_person: null,
  other_shift_id: null, other_date: null, other_type_id: null, from_date: null, to_date: null, notes: null, status: 'offen',
  decided_by: null, decided_at: null, decision_note: null, created_by: null, updated_at: '', deleted_at: null, absence_kind: null, counter_status: null, counter_at: null, ...r,
})

describe('slotById', () => {
  it('findet den Platz über die feste id, auch ohne Zeile in duty_shifts', () => {
    const s = slotById([type], [], T1, '2026-11-03', shiftId(T1, '2026-11-03', 1))
    expect(s?.slot).toBe(1)
    expect(s?.shift).toBeNull()
  })
  it('null bei fremder id', () => {
    expect(slotById([type], [], T1, '2026-11-03', shiftId(T1, '2026-11-04', 0))).toBeNull()
  })
})

describe('checkRequest', () => {
  it('Abgabe ok, solange der Dienst der Person gehört', () => {
    expect(checkRequest(data([shift('2026-11-03', ANNA)]), req({})).ok).toBe(true)
  })
  it('Abgabe nicht mehr umsetzbar, wenn der Dienst inzwischen jemand anderem gehört', () => {
    const c = checkRequest(data([shift('2026-11-03', BEAT)]), req({}))
    expect(c.ok).toBe(false)
    expect(c.notes[0]).toContain('gehört nicht mehr')
  })
  it('Tausch braucht den Gegen-Dienst bei der Tauschperson', () => {
    const d = data([shift('2026-11-03', ANNA), shift('2026-11-04', BEAT)])
    const r = req({ kind: 'tausch', to_person: BEAT, other_shift_id: shiftId(T1, '2026-11-04', 0), other_date: '2026-11-04', other_type_id: T1 })
    expect(checkRequest(d, r).ok).toBe(true)
    expect(checkRequest(data([shift('2026-11-03', ANNA), shift('2026-11-04', ANNA)]), r).ok).toBe(false)
  })
  it('Freiwunsch braucht einen Zeitraum', () => {
    expect(checkRequest(data([]), req({ kind: 'wunsch', from_date: '2026-11-10', to_date: '2026-11-12' })).ok).toBe(true)
    expect(checkRequest(data([]), req({ kind: 'wunsch' })).ok).toBe(false)
  })
})
