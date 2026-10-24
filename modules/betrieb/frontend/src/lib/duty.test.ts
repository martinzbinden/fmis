import { describe, expect, it } from 'vitest'
import { conflictsFor, copyFromPrevious, endTime, inMonthDayRange, isoWeek, isSummer, mondayOf, parseTimes, shiftId, slotsFor, slotsOn, stringifyTimes, suggest, timeOn, typeLabel, weekDates, monthGrid, runsOf, toQuarters, fromQuarters, timeText, rangesOverlap } from './duty'
import type { DutyAbsence, DutyPerson, DutyShift, DutySkill, DutyType } from '../types'

const T = (id: string, name: string, start: string, dur: number, weekdays = '1111111'): DutyType => ({
  id, name, start_time: start, duration_min: dur, weekdays, color: null, description: null, active: true, sort_order: 0, updated_at: '', deleted_at: null,
  animal: null, active_from: null, active_to: null, summer_from: null, summer_to: null, times: null,
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

describe('Saison und Zeiten je Wochentag', () => {
  it('Zeitraum, auch über den Jahreswechsel', () => {
    expect(inMonthDayRange('2026-06-15', '04-01', '10-31')).toBe(true)
    expect(inMonthDayRange('2026-11-15', '04-01', '10-31')).toBe(false)
    expect(inMonthDayRange('2026-12-24', '11-01', '03-31')).toBe(true)
    expect(inMonthDayRange('2027-02-10', '11-01', '03-31')).toBe(true)
    expect(inMonthDayRange('2026-07-01', '11-01', '03-31')).toBe(false)
    expect(inMonthDayRange('2026-07-01', null, null)).toBe(true)
  })

  it('nicht ganzjährig aktiver Dienst gibt es nur im Fenster', () => {
    const abends = { ...T('a', 'Melken abends', '17:00', 90), active_from: '03-01', active_to: '10-31' }
    expect(slotsOn(abends, '2026-05-05')).toBe(1)
    expect(slotsOn(abends, '2026-12-05')).toBe(0)
    expect(slotsFor([abends], [], ['2026-05-05', '2026-12-05']).map((s) => s.date)).toEqual(['2026-05-05'])
  })

  it('Sommer und Winter mit eigenen Zeiten je Wochentag', () => {
    const times = stringifyTimes({
      sommer: [[[330, 90]], null, null, null, null, null, null],
      winter: [[[390, 90]], null, null, null, null, null, [[480, 60]]],
    })
    const t = { ...T('k', 'Melken morgens', '06:00', 75), times }
    // Mo 3.8.2026 (Sommer) = 05:30, Mo 7.12.2026 (Winter) = 06:30, Di = Standard, So Winter = 08:00
    expect(timeOn(t, '2026-08-03')).toEqual({ start_time: '05:30', duration_min: 90, blocks: null })
    expect(timeOn(t, '2026-12-07')).toEqual({ start_time: '06:30', duration_min: 90, blocks: null })
    expect(timeOn(t, '2026-12-08')).toEqual({ start_time: '06:00', duration_min: 75, blocks: null })
    expect(timeOn(t, '2026-12-13')).toEqual({ start_time: '08:00', duration_min: 60, blocks: null })
    // der Platz im Plan trägt die Zeit des Tages
    const slot = slotsFor([t], [], ['2026-12-07'])[0]
    expect(slot.type.start_time).toBe('06:30')
    expect(endTime(slot.type)).toBe('08:00')
  })

  it('eigene Sommerdefinition', () => {
    const t = { ...T('k', 'x', '06:00', 60), summer_from: '05-15', summer_to: '09-15' }
    expect(isSummer('2026-05-14', t)).toBe(false)
    expect(isSummer('2026-07-01', t)).toBe(true)
  })

  it('Ungültiges in times gilt als nicht gesetzt', () => {
    expect(parseTimes('kaputt')).toBeNull()
    expect(parseTimes(null)).toBeNull()
    expect(parseTimes('{"sommer":[[5000,60]],"winter":[]}')).toBeNull()
  })

  it('Tierart wird vorangestellt', () => {
    expect(typeLabel({ name: 'Melken morgens', animal: 'Kühe' })).toBe('Kühe · Melken morgens')
    expect(typeLabel({ name: 'Weidekontrolle Wyden', animal: null })).toBe('Weidekontrolle Wyden')
  })
})


describe('Kalender', () => {
  it('Monatsraster beginnt am Montag', () => {
    const g = monthGrid(2026, 11) // 1.11.2026 = Sonntag
    expect(g[0]).toEqual([null, null, null, null, null, null, '2026-11-01'])
    expect(g.flat().filter(Boolean)).toHaveLength(30)
    expect(g.every((w) => w.length === 7)).toBe(true)
  })
  it('gewählte Tage werden zu Zeiträumen', () => {
    expect(runsOf(['2026-11-12', '2026-11-10', '2026-11-11', '2026-11-20', '2026-11-30', '2026-12-01'])).toEqual([
      ['2026-11-10', '2026-11-12'],
      ['2026-11-20', '2026-11-20'],
      ['2026-11-30', '2026-12-01'],
    ])
  })
})

describe('Lücken und Zeitschaltuhr', () => {
  it('Viertelstunden ↔ Blöcke', () => {
    const q = toQuarters([[360, 60], [1020, 45]])
    expect(q.filter(Boolean)).toHaveLength(7)
    expect(fromQuarters(q)).toEqual([[360, 60], [1020, 45]])
  })
  it('altes Format (ein Block je Tag) wird weiter gelesen', () => {
    const t = parseTimes('{"sommer":[[330,90],null,null,null,null,null,null],"winter":[]}')
    expect(t?.sommer[0]).toEqual([[330, 90]])
  })
  it('Dienst mit Lücke: Zeiten, Anzeige, Überschneidung', () => {
    const times = stringifyTimes({ sommer: Array(7).fill([[420, 60], [1020, 60]]), winter: Array(7).fill(null) })
    const t = { ...T('h', 'Hühner', '13:00', 60), times }
    const on = timeOn(t, '2026-07-01')
    expect(on.start_time).toBe('07:00')
    expect(on.blocks).toEqual([[420, 60], [1020, 60]])
    expect(timeText({ ...t, ...on })).toBe('07:00–08:00, 17:00–18:00')
    const mittag = { ...T('m', 'Mittag', '12:00', 60) }
    const abend = { ...T('a', 'Abend', '17:30', 30) }
    expect(rangesOverlap({ ...t, ...on }, mittag)).toBe(false) // fällt in die Lücke
    expect(rangesOverlap({ ...t, ...on }, abend)).toBe(true)
  })
})

