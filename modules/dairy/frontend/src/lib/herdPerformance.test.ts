import { describe, expect, it } from 'vitest'
import { expectedByGroup, geoMean, indexScale, totalIndex } from './herdPerformance'

describe('expectedByGroup', () => {
  it('interpoliert kleine Gruppen zwischen zwei sicheren Nachbarn', () => {
    const values = [
      ...Array.from({ length: 5 }, () => ({ group: 1, value: 0.2 })),
      { group: 2, value: 9 }, // nur ein Tier — zu unsicher
      ...Array.from({ length: 5 }, () => ({ group: 3, value: 0.6 })),
    ]
    const e = expectedByGroup(values)
    expect(e.get(1)).toBeCloseTo(0.2)
    expect(e.get(2)).toBeCloseTo(0.4)
    expect(e.get(3)).toBeCloseTo(0.6)
  })

  it('übernimmt am Rand den nächsten sicheren Wert', () => {
    const values = [...Array.from({ length: 5 }, () => ({ group: 2, value: 0.5 })), { group: 7, value: 3 }]
    expect(expectedByGroup(values).get(7)).toBeCloseTo(0.5)
  })

  it('nimmt den Rohwert, wenn keine Gruppe sicher ist', () => {
    expect(expectedByGroup([{ group: 1, value: 0.3 }, { group: 1, value: 0.5 }]).get(1)).toBeCloseTo(0.4)
  })
})

describe('indexScale', () => {
  it('skaliert auf Mittel 100 / Streuung 10', () => {
    const idx = indexScale(new Map([['a', 1], ['b', 3], ['c', null]]))
    expect(idx.get('a')).toBe(90)
    expect(idx.get('b')).toBe(110)
    expect(idx.get('c')).toBeNull()
  })

  it('dreht bei der Zellzahl das Vorzeichen (tief = gut)', () => {
    const idx = indexScale(new Map([['tief', 100], ['hoch', 400]]), { invert: true, log: true })
    expect(idx.get('tief')).toBe(110)
    expect(idx.get('hoch')).toBe(90)
  })

  it('braucht mindestens zwei Werte', () => {
    expect(indexScale(new Map([['a', 1]])).get('a')).toBeNull()
  })
})

describe('totalIndex', () => {
  it('setzt fehlende Teilwerte auf das Herdenmittel 100', () => {
    expect(totalIndex(110, null)).toBe(106)
    expect(totalIndex(null, 80)).toBe(92)
    expect(totalIndex(null, null)).toBeNull()
  })
})

describe('geoMean', () => {
  it('ignoriert fehlende und Null-Werte', () => {
    expect(geoMean([100, 400, null, 0])).toBeCloseTo(200)
  })
})
