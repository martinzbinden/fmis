import { describe, expect, it } from 'vitest'
import { estimateAll, estimateFromParents, type ParentLinks } from './breedingEstimate'
import type { AnimalContext } from './herdContext'

describe('estimateFromParents', () => {
  it('beide Eltern: Mittel', () => {
    expect(estimateFromParents(112, 104)).toMatchObject({ value: 108, basis: 'beide' })
  })
  it('nur ein Elternteil: der andere zählt als Populationsmittel 100', () => {
    expect(estimateFromParents(112, null)).toMatchObject({ value: 106, basis: 'mutter', dam: 112, sire: null })
    expect(estimateFromParents(null, 90)).toMatchObject({ value: 95, basis: 'vater' })
  })
  it('kein Elternwert: keine Schätzung', () => {
    expect(estimateFromParents(null, null)).toBeNull()
  })
})

describe('estimateAll', () => {
  const ctx = (tag: string, gzw?: number) => ({ animal: { id: tag, ear_tag: tag }, breedingValues: gzw == null ? {} : { gzw: { value: gzw, reliability: null, eval_date: '2026-01-01', base: null } } }) as unknown as AnimalContext
  const links: ParentLinks = {
    parents: new Map([['CH90000003', { sire: 'CH90000099', dam: 'CH90000001' }], ['CH90000004', { sire: null, dam: null }]]),
    external: new Map([['CH90000099', 120]]),
  }
  it('Mutter im Bestand, Vater im Leistungsausweis; eigene Werte bleiben unberührt', () => {
    const m = new Map([['a', ctx('CH90000001', 110)], ['b', ctx('CH90000003')], ['c', ctx('CH90000004')], ['d', ctx('CH90000005', 95)]])
    const est = estimateAll(m, links, 'gzw')
    expect(est.get('CH90000003')).toMatchObject({ value: 115, basis: 'beide' })
    expect(est.has('CH90000001')).toBe(false)
    expect(est.has('CH90000004')).toBe(false)
    expect(est.has('CH90000005')).toBe(false)
  })
})
