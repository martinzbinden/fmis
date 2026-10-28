import { describe, expect, it } from 'vitest'
import { compareRounds, examiners, fmtDuration, fromWeeks, groupRounds, isYoung, matchAnimals, summarize, toWeeks, uniqueMatch } from './pregnancy'
import type { Animal } from '../types'

const a = (id: string, ear_tag: string, lauf_nr: string | null = null): Animal => ({
  id, ear_tag, lauf_nr, name: null, breed_code: null, birth_date: null, sex: 'w', status: 'aktiv', entry_date: null, exit_date: null, notes: null, updated_at: '', deleted_at: null,
})
const herd = [a('1', 'CH21728023', '7'), a('2', 'CH21718023', '12'), a('3', 'CH21725501', '23'), a('4', 'CH113196787890', '40')]

describe('Tier über die Ohrmarke finden', () => {
  it('findet nach den letzten Ziffern, auch bei Langform', () => {
    expect(matchAnimals(herd, '8023').map((x) => x.id)).toEqual(['1', '2'])
    expect(matchAnimals(herd, '28023').map((x) => x.id)).toEqual(['1'])
    expect(uniqueMatch(herd, '5501')?.id).toBe('3')
    expect(uniqueMatch(herd, '8023')).toBeNull()
  })
  it('nimmt bei wenigen Ziffern auch die Laufnummer, wählt aber nicht automatisch', () => {
    expect(matchAnimals(herd, '12').map((x) => x.id)).toContain('2')
    expect(uniqueMatch(herd, '01')).toBeNull()
  })
  it('zählt je Tier den letzten Eintrag', () => {
    expect(summarize([
      { animal_id: '1', result: 'unsicher', recorded_at: '2026-10-28T08:00:00Z' },
      { animal_id: '1', result: 'ja', recorded_at: '2026-10-28T08:05:00Z' },
      { animal_id: '2', result: 'nein', recorded_at: '2026-10-28T08:01:00Z' },
    ])).toEqual({ ja: 1, nein: 1, unsicher: 0 })
  })
  it('fasst Durchgänge zusammen, neuester zuerst', () => {
    const c = (animal_id: string, result: 'ja' | 'nein', recorded_at: string, round_id: string | null, examiner: string | null) =>
      ({ animal_id, result, recorded_at, round_id, examiner, check_date: recorded_at.slice(0, 10), method: null, duration_unit: null })
    const checks = [
      c('1', 'ja', '2026-10-28T08:00:00Z', 'r1', 'Martin Zbinden'),
      c('2', 'nein', '2026-10-28T08:01:00Z', 'r1', 'Martin Zbinden'),
      c('1', 'nein', '2026-10-28T15:00:00Z', 'r2', 'Tierarzt'),
      c('3', 'ja', '2026-10-20T15:00:00Z', null, null),
    ]
    const r = groupRounds(checks)
    expect(r.map((x) => [x.id, x.count])).toEqual([['r2', 1], ['r1', 2], ['tag:2026-10-20', 1]])
    expect(r[1].results).toEqual({ ja: 1, nein: 1, unsicher: 0 })
    expect(examiners(checks)).toEqual(['Tierarzt', 'Martin Zbinden'])
  })
  it('rechnet Tage und Wochen um', () => {
    expect(toWeeks('45', 'tage')).toBeCloseTo(45 / 7)
    expect(fromWeeks(45 / 7, 'tage')).toBe('45')
    expect(toWeeks('8,5', 'wochen')).toBe(8.5)
    expect(toWeeks('', 'wochen')).toBeNull()
    expect(fmtDuration(45 / 7, 'tage')).toBe('45 T.')
    expect(fmtDuration(8, null)).toBe('8 Wo.')
  })
  it('stellt Durchgänge je Tier nebeneinander und markiert Abweichungen', () => {
    const c = (animal_id: string, result: 'ja' | 'nein' | 'unsicher', round_id: string, recorded_at = '2026-10-28T08:00:00Z') =>
      ({ animal_id, result, round_id, recorded_at, check_date: '2026-10-28', weeks: null, duration_unit: null })
    const rows = compareRounds([c('1', 'ja', 'a'), c('1', 'ja', 'b'), c('2', 'ja', 'a'), c('2', 'nein', 'b'), c('3', 'unsicher', 'b'), c('4', 'ja', 'x')], ['a', 'b'])
    expect(rows.map((r) => [r.animal_id, r.cells.map((x) => x?.result ?? '-').join(''), r.differs])).toEqual([
      ['1', 'jaja', false],
      ['2', 'janein', true],
      ['3', '-unsicher', false],
    ])
  })
})

describe('isYoung', () => {
  it('blendet Lämmer unter 7 Monaten am Stichtag aus', () => {
    expect(isYoung({ birth_date: '2026-04-01' }, '2026-10-28')).toBe(true)
    expect(isYoung({ birth_date: '2026-03-28' }, '2026-10-28')).toBe(false)
    expect(isYoung({ birth_date: '2025-01-06' }, '2026-10-28')).toBe(false)
    expect(isYoung({ birth_date: null }, '2026-10-28')).toBe(false)
  })
})
