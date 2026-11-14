import { describe, expect, it } from 'vitest'
import { buildPlan, isValuable, pregnancyAdjustment, priority, valueScores, type Mark, type PlanBase } from './cullingPlan'
import type { PregnancyStatus } from './pregnancy'

const TODAY = '2026-11-14'
const preg = (result: PregnancyStatus['result'], date: string): PregnancyStatus => ({ result, date, examiner: null, method: null, weeks: null })
const row = (id: string, score: number, over: Partial<PlanBase> = {}): PlanBase => ({ id, label: id, score, pregnancy: null, value: null, ...over })
const opts = (n: number, valueThreshold = 110) => ({ n, today: TODAY, valueThreshold })
const states = (rows: PlanBase[], marks: [string, Mark][] = [], n = 3, thr = 110) => buildPlan(rows, new Map(marks), opts(n, thr)).shown.map((s) => `${s.row.id}:${s.state}`)

describe('pregnancyAdjustment', () => {
  it('frisches leer zählt mehr als altes, trächtig zieht ab', () => {
    expect(pregnancyAdjustment(preg('nein', '2026-11-01'), TODAY)).toBe(3)
    expect(pregnancyAdjustment(preg('nein', '2026-08-20'), TODAY)).toBe(2)
    expect(pregnancyAdjustment(preg('nein', '2026-01-01'), TODAY)).toBe(1)
    expect(pregnancyAdjustment(preg('unsicher', '2026-11-10'), TODAY)).toBe(1)
    expect(pregnancyAdjustment(preg('ja', '2026-11-10'), TODAY)).toBe(-4)
    expect(pregnancyAdjustment(null, TODAY)).toBe(0)
  })
  it('Dringlichkeit = Punkte plus Trächtigkeit', () => {
    expect(priority({ score: 2, pregnancy: preg('nein', '2026-11-10') }, TODAY)).toBe(5)
  })
})

describe('valueScores', () => {
  it('Mittel aus den vorhandenen Teilen, ohne Teile null', () => {
    const v = valueScores([
      { id: 'a', idxPerformance: 110, idxScc: 100, totalBv: null, litterMean: null },
      { id: 'b', idxPerformance: null, idxScc: null, totalBv: null, litterMean: null },
    ])
    expect(v.get('a')).toBe(106) // 0.6 * 110 + 0.4 * 100
    expect(v.get('b')).toBeNull()
  })
  it('Zuchtwert und Wurfgrösse werden herdenweit auf Mittel 100 gerechnet', () => {
    const v = valueScores([
      { id: 'a', idxPerformance: null, idxScc: null, totalBv: 100, litterMean: 1 },
      { id: 'b', idxPerformance: null, idxScc: null, totalBv: 110, litterMean: 2 },
      { id: 'c', idxPerformance: null, idxScc: null, totalBv: 120, litterMean: 3 },
    ])
    expect(v.get('b')).toBe(100)
    expect(v.get('c')!).toBeGreaterThan(100)
    expect(v.get('a')!).toBeLessThan(100)
  })
})

describe('isValuable', () => {
  it('ab der Grenze, 0 = aus, ohne Wert nie', () => {
    expect(isValuable(110, 110)).toBe(true)
    expect(isValuable(109.9, 110)).toBe(false)
    expect(isValuable(130, 0)).toBe(false)
    expect(isValuable(null, 110)).toBe(false)
  })
})

describe('buildPlan', () => {
  const rows = [row('a', 6), row('b', 5), row('c', 4), row('d', 3), row('e', 2), row('f', 0)]
  it('die ersten N nach Dringlichkeit, ohne Punkte kein Kandidat', () => {
    expect(states(rows)).toEqual(['a:vorschlag', 'b:vorschlag', 'c:vorschlag'])
    expect(states(rows, [], 10)).toHaveLength(5)
  })
  it('Daumen hoch: ausgegraut an seinem Platz, das nächste rückt nach', () => {
    expect(states(rows, [['b', 'leben']])).toEqual(['a:vorschlag', 'b:leben', 'c:vorschlag', 'd:vorschlag'])
  })
  it('Daumen runter: fest und zählt mit', () => {
    expect(states(rows, [['e', 'schlachten']])).toEqual(['a:vorschlag', 'b:vorschlag', 'e:fix'])
  })
  it('mehr feste als N: alle bleiben, sonst nichts', () => {
    expect(states(rows, [['a', 'schlachten'], ['b', 'schlachten'], ['f', 'schlachten']], 2)).toEqual(['a:fix', 'b:fix', 'f:fix'])
  })
  it('wertvolle Tiere bekommen eine Chance: ausgegraut, für sie rückt nach', () => {
    const rs = [row('a', 6, { value: 120 }), row('b', 5), row('c', 4), row('d', 3)]
    expect(states(rs, [], 2)).toEqual(['a:chance', 'b:vorschlag', 'c:vorschlag'])
  })
  it('Daumen runter holt ein wertvolles Tier auf die Liste', () => {
    const rs = [row('a', 6, { value: 120 }), row('b', 5), row('c', 4)]
    expect(states(rs, [['a', 'schlachten']], 2)).toEqual(['a:fix', 'b:vorschlag'])
  })
  it('Schutz aus (Grenze 0)', () => {
    expect(states([row('a', 6, { value: 150 }), row('b', 5)], [], 1, 0)).toEqual(['a:vorschlag'])
  })
  it('trächtig fällt hinter leer, frisches leer rückt vor', () => {
    const rs = [row('traechtig', 4, { pregnancy: preg('ja', '2026-11-05') }), row('leer', 2, { pregnancy: preg('nein', '2026-11-05') }), row('alt', 3)]
    expect(states(rs, [], 2)).toEqual(['leer:vorschlag', 'alt:vorschlag'])
  })
  it('weniger wertvolles Tier zuerst bei gleicher Dringlichkeit', () => {
    const rs = [row('hoch', 3, { value: 105 }), row('tief', 3, { value: 90 })]
    expect(states(rs, [], 1)).toEqual(['tief:vorschlag'])
  })
  it('zählt aktive und wartende', () => {
    const p = buildPlan(rows, new Map([['b', 'leben' as Mark]]), opts(2))
    expect(p.active).toBe(2)
    expect(p.waiting).toBe(2) // d und e würden nachrücken (c ist schon gezeigt)
  })
})
