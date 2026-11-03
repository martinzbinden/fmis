import { describe, expect, it } from 'vitest'
import { BREAKS, classIndex, daysBetween, legendLabels, parcelMetrics } from './parcelColor'

describe('parcelMetrics', () => {
  it('zählt Schnitte, Weidetage (je Datum einmal) und die letzte Nutzung', () => {
    const m = parcelMetrics(
      [
        { parcel_id: 'a', entry_date: '2026-05-02', usage_type: 'eingrasen' },
        { parcel_id: 'a', entry_date: '2026-06-20', usage_type: 'silage' },
        { parcel_id: 'a', entry_date: '2026-07-01', usage_type: 'weide' },
        { parcel_id: 'a', entry_date: '2026-07-01', usage_type: 'weide' },
        { parcel_id: 'a', entry_date: '2026-07-02', usage_type: 'weide' },
        { parcel_id: 'a', entry_date: '2026-08-01', usage_type: 'blacken_stechen' },
        { parcel_id: 'b', entry_date: '2026-12-01', usage_type: 'weide' },
      ],
      '2026-11-03',
    )
    expect(m.get('a')).toEqual({ cuts: 2, grazingDays: 2, lastUse: '2026-07-02' })
    expect(m.has('b')).toBe(false)
  })
})

describe('Klassen', () => {
  it('ordnet Werte Stufen zu und beschriftet die Legende', () => {
    expect(classIndex(0, BREAKS.schnitte)).toBe(-1)
    expect(classIndex(3, BREAKS.schnitte)).toBe(2)
    expect(classIndex(99, BREAKS.weidetage)).toBe(4)
    expect(legendLabels(BREAKS.schnitte)).toEqual(['1', '2', '3', '4', '≥ 5'])
    expect(legendLabels(BREAKS.ruhe)).toEqual(['0–13', '14–27', '28–41', '42–59', '≥ 60'])
    expect(daysBetween('2026-07-02', '2026-11-03')).toBe(124)
  })
})
