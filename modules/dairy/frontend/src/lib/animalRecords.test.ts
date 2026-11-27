import { describe, expect, it } from 'vitest'
import { durationText, parseKg } from './animalRecords'
import { youngLabels, type DamYoung } from './provisional'

describe('Erfassungen der Tierseite', () => {
  it('liest Gewichte mit Komma oder Punkt und rundet auf 100 g', () => {
    expect(parseKg('12,46')).toBe(12.5)
    expect(parseKg(' 3.2 ')).toBe(3.2)
    expect(parseKg('')).toBeNull()
    expect(parseKg('0')).toBeNull()
    expect(parseKg('abc')).toBeNull()
  })

  it('zeigt die Trächtigkeitsdauer in Wochen oder Tagen', () => {
    expect(durationText(6, 'wochen')).toBe('6 Wochen')
    expect(durationText(1, null)).toBe('1 Woche')
    expect(durationText(40 / 7, 'tage')).toBe('40 Tage')
    expect(durationText(null, 'wochen')).toBeNull()
  })
})

describe('Jungtiere ohne Ohrmarke auf der Tierseite der Mutter', () => {
  const young = (id: string, extra: Partial<DamYoung> = {}): DamYoung => ({
    id,
    birth_id: 'b1',
    import_key: null,
    sex: 'w',
    stillborn: false,
    died_24h: false,
    died_on: null,
    ear_tag: null,
    ...extra,
  })

  it('nummeriert im Wurf wie die Lämmerliste und kennzeichnet verendete', () => {
    const labels = youngLabels([young('o2', { import_key: 'x|#1', died_on: '2026-03-04' }), young('o1', { import_key: 'x|#0', sex: 'm' })], '101')
    expect(labels.get('o1')).toEqual({ nr: '101-1', dead: false, sex: 'm' })
    expect(labels.get('o2')).toEqual({ nr: '101-2', dead: true, sex: 'w' })
  })

  it('zählt Totgeburten mit, ohne Schlüssel nach Reihenfolge', () => {
    const labels = youngLabels([young('a', { stillborn: true }), young('b')], null)
    expect(labels.get('a')).toMatchObject({ nr: '?-1', dead: true })
    expect(labels.get('b')).toMatchObject({ nr: '?-2', dead: false })
  })
})
