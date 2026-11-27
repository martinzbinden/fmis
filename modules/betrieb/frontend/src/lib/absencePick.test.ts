import { describe, expect, it } from 'vitest'
import { pickDay, type PickState } from './absencePick'

const empty: PickState = { sel: new Set(), anchor: null, start: null }
const days = (s: PickState) => [...s.sel].sort()

describe('Abwesenheit: Tage wählen', () => {
  it('von–bis: erster Tipp = Anfang, zweiter = Ende', () => {
    const a = pickDay(empty, '2026-12-21', 'bereich')
    expect(days(a)).toEqual(['2026-12-21'])
    expect(a.start).toBe('2026-12-21')
    const b = pickDay(a, '2026-12-24', 'bereich')
    expect(days(b)).toEqual(['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24'])
    expect(b.start).toBeNull()
  })
  it('von–bis rückwärts und über den Monatswechsel; zweiter Zeitraum kommt dazu', () => {
    const a = pickDay(pickDay(empty, '2027-01-02', 'bereich'), '2026-12-30', 'bereich')
    expect(days(a)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    const b = pickDay(pickDay(a, '2027-01-10', 'bereich'), '2027-01-10', 'bereich')
    expect(days(b)).toHaveLength(5)
  })
  it('einzeln: schaltet; Shift-Klick wählt ab dem zuletzt angetippten Tag', () => {
    const a = pickDay(empty, '2026-12-01', 'einzeln')
    expect(days(pickDay(a, '2026-12-01', 'einzeln'))).toEqual([])
    const b = pickDay(a, '2026-12-03', 'einzeln', true)
    expect(days(b)).toEqual(['2026-12-01', '2026-12-02', '2026-12-03'])
  })
})
