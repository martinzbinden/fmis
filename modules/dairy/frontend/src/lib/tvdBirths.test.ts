import { describe, expect, it } from 'vitest'
import { ageDays, COLUMNS, ddmmyyyy, deadlineDays, deadlineTone, lambFields, lambState, reportable, toCsv, toTabText, type TvdBirth, type TvdLamb } from './tvdBirths'

const lamb = (over: Partial<TvdLamb> = {}): TvdLamb => ({ id: 'l1', ear_tag: 'CH90000101', sex: 'w', stillborn: false, diedUntagged: false, breed: 'MIL', reportedOn: null, ...over })
const birth = (over: Partial<TvdBirth> = {}): TvdBirth => ({
  id: 'b1',
  birth_date: '2026-03-04',
  dam_ear_tag: 'CH90000001',
  dam_lauf_nr: '12',
  dam_name: null,
  sire: null,
  litter: 2,
  offspring: [lamb(), lamb({ id: 'l2', ear_tag: 'CH90000102', sex: 'm' })],
  ...over,
})

describe('lambState', () => {
  it('open with tag, done once reported', () => {
    expect(lambState(lamb())).toBe('offen')
    expect(lambState(lamb({ reportedOn: '2026-03-10' }))).toBe('gemeldet')
  })
  it('without tag: pending tag, or nothing to report if died before tagging', () => {
    expect(lambState(lamb({ ear_tag: null }))).toBe('ohne_marke')
    expect(lambState(lamb({ ear_tag: null, diedUntagged: true }))).toBe('nicht_noetig')
  })
})

describe('lines for the portal', () => {
  it('has the fields in the order of COLUMNS', () => {
    const f = lambFields(birth(), lamb())
    expect(f).toHaveLength(COLUMNS.length)
    expect(f).toEqual(['04.03.2026', 'CH90000101', 'weiblich', 'MIL', 'CH90000001', 'unbekannt', 'nein', '2'])
  })
  it('stillborn with a tag is marked as Totgeburt, known sire is used', () => {
    const f = lambFields(birth({ sire: 'CH90000555' }), lamb({ stillborn: true, sex: 'm' }))
    expect(f[2]).toBe('männlich')
    expect(f[5]).toBe('CH90000555')
    expect(f[6]).toBe('ja')
  })
  it('only open lambs with a tag are listed', () => {
    const b = birth({ offspring: [lamb(), lamb({ id: 'x', reportedOn: '2026-03-09' }), lamb({ id: 'y', ear_tag: null })] })
    expect(reportable(b).map((l) => l.id)).toEqual(['l1'])
    expect(toTabText([b]).split('\n')).toHaveLength(2) // Kopf + 1 Lamm
  })
  it('tab text is empty without open lambs; CSV has a BOM and a header', () => {
    expect(toTabText([birth({ offspring: [lamb({ reportedOn: '2026-03-09' })] })])).toBe('')
    const csv = toCsv([birth()])
    expect(csv.startsWith('﻿Ereignisdatum;Ohrmarke;')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(3)
  })
  it('quotes cells with a semicolon', () => {
    expect(toCsv([birth({ offspring: [lamb({ breed: 'A;B' })] })])).toContain('"A;B"')
  })
})

describe('dates and deadlines', () => {
  it('formats dd.mm.yyyy', () => expect(ddmmyyyy('2026-03-04')).toBe('04.03.2026'))
  it('counts days and rates the deadline', () => {
    expect(ageDays('2026-03-04', '2026-03-14')).toBe(10)
    expect(deadlineDays('sheep')).toBe(30)
    expect(deadlineTone(10, 30)).toBe('ok')
    expect(deadlineTone(24, 30)).toBe('soon')
    expect(deadlineTone(31, 30)).toBe('over')
  })
})
