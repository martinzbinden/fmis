import { describe, expect, it } from 'vitest'
import { canChangeEntry, groupCases, supersededBy } from './journal'

const e = (id: string, entry_date: string, extra: Record<string, unknown> = {}) => ({
  id, entry_date, animal_id: 'a1', case_id: null as string | null, corrects_id: null as string | null, treatment_time: null as string | null, updated_at: entry_date, deleted_at: null as string | null, ...extra,
})

describe('supersededBy', () => {
  it('ein Eintrag gilt als korrigiert, sobald ein anderer auf ihn zeigt', () => {
    const list = [e('1', '2026-10-01'), e('2', '2026-10-02', { corrects_id: '1' })]
    expect([...supersededBy(list).keys()]).toEqual(['1'])
  })
  it('gelöschte Korrekturen zählen nicht', () => {
    const list = [e('1', '2026-10-01'), e('2', '2026-10-02', { corrects_id: '1', deleted_at: '2026-10-03' })]
    expect(supersededBy(list).size).toBe(0)
  })
  it('mehrere Korrekturen: die jüngste wird genannt', () => {
    const list = [e('1', '2026-10-01'), e('2', '2026-10-02', { corrects_id: '1' }), e('3', '2026-10-05', { corrects_id: '1' })]
    expect(supersededBy(list).get('1')?.id).toBe('3')
  })
})

describe('groupCases', () => {
  it('gleiche case_id = ein Fall, älteste zuerst; neueste Aktivität oben', () => {
    const list = [
      e('a', '2026-10-01', { case_id: 'c1' }),
      e('b', '2026-10-05', { case_id: 'c1' }),
      e('c', '2026-10-03'),
    ]
    const g = groupCases(list)
    expect(g.map((c) => c.key)).toEqual(['a1|c1', 'c'])
    expect(g[0].entries.map((x) => x.id)).toEqual(['a', 'b'])
    expect(g[0].isCase).toBe(true)
    expect(g[1].isCase).toBe(false)
  })
  it('vermischt nie verschiedene Tiere', () => {
    const list = [e('a', '2026-10-01', { case_id: 'c1' }), e('b', '2026-10-02', { case_id: 'c1', animal_id: 'a2' })]
    expect(groupCases(list)).toHaveLength(2)
  })
  it('mehrere Präparate am selben Tag bleiben beisammen (Reihenfolge nach Uhrzeit)', () => {
    const list = [e('x', '2026-10-01', { case_id: 'c', treatment_time: '18:00' }), e('y', '2026-10-01', { case_id: 'c', treatment_time: '07:00' })]
    expect(groupCases(list)[0].entries.map((r) => r.id)).toEqual(['y', 'x'])
  })
})

describe('groupCases Reihenfolge am selben Tag', () => {
  it('nach Erfassungszeit', () => {
    const list = [
      e('spaet', '2026-10-24', { case_id: 'c', updated_at: '2026-10-24T10:00:00Z' }),
      e('frueh', '2026-10-24', { case_id: 'c', updated_at: '2026-10-24T08:00:00Z' }),
    ]
    expect(groupCases(list)[0].entries.map((x) => x.id)).toEqual(['frueh', 'spaet'])
  })
})

describe('canChangeEntry', () => {
  const now = Date.parse('2026-10-23T12:00:00Z')
  const at = (min: number) => new Date(now - min * 60_000).toISOString()
  it('Mitarbeit: nur innert 10 Minuten', () => {
    expect(canChangeEntry({ updated_at: at(9), source: 'manual' }, false, now)).toBe(true)
    expect(canChangeEntry({ updated_at: at(11), source: 'manual' }, false, now)).toBe(false)
  })
  it('Büro (Recht vorhanden): immer, aber nie importierte oder Milchwägungs-Einträge', () => {
    expect(canChangeEntry({ updated_at: at(5000), source: 'manual' }, true, now)).toBe(true)
    expect(canChangeEntry({ updated_at: at(1), source: 'import' }, true, now)).toBe(false)
  })
})
