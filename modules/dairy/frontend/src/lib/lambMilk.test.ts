import { describe, expect, it } from 'vitest'
import { DEFAULT_LAMB_MILK as S, lambMilk, milkByDam, sucklingMilkByDam } from './lambMilk'
import type { Lamb } from './lambs'

const lamb = (p: Partial<Lamb>): Lamb => ({ key: 'a', offspringId: 'a', animalId: null, earTag: null, lauf_nr: null, name: null, sex: null, birthDate: '2026-01-01', ageDays: 20, damId: 'm1', litter: 1, litterIndex: 1, reportedAt: null, birthWeight: 4, weights: [], gainPerDay: null, weanDate: null, nursing: true, bucketFrom: null, suckling: true, ...p })

describe('lambMilk', () => {
  it('Zuwachs mal Faktor: 5 kg in 21 Tagen = 25 kg Milch', () => {
    const e = lambMilk(lamb({ weights: [{ date: '2026-01-22', kg: 9 }] }), S)!
    expect(e.days).toBe(21)
    expect(e.gainKg).toBe(5)
    expect(e.milkKg).toBe(25)
    expect(e.milkPerDay).toBeCloseTo(25 / 21, 5)
    expect(e.gainPerDay).toBeCloseTo(5000 / 21, 3)
  })
  it('bricht bei maxDays ab und interpoliert das Gewicht', () => {
    // Tag 21: 9 kg, Tag 49: 16 kg → Tag 35: 12.5 kg
    const e = lambMilk(lamb({ weights: [{ date: '2026-01-22', kg: 9 }, { date: '2026-02-19', kg: 16 }] }), S)!
    expect(e.to).toBe('2026-02-05')
    expect(e.gainKg).toBeCloseTo(8.5, 5)
  })
  it('endet beim Absetzen und bei der Umstellung auf Eimer', () => {
    const w = [{ date: '2026-01-29', kg: 10 }]
    expect(lambMilk(lamb({ weights: w, weanDate: '2026-01-15' }), S)!.to).toBe('2026-01-15')
    expect(lambMilk(lamb({ weights: w }), S, '2026-01-12')!.to).toBe('2026-01-12')
  })
  it('zu wenig Wägungen oder zu kurzer Abstand: keine Schätzung', () => {
    expect(lambMilk(lamb({ birthWeight: null, weights: [{ date: '2026-01-22', kg: 9 }] }), S)).toBeNull()
    expect(lambMilk(lamb({ weights: [{ date: '2026-01-05', kg: 5 }] }), S)).toBeNull()
  })
  it('kein negativer Zuwachs', () => {
    expect(lambMilk(lamb({ weights: [{ date: '2026-01-22', kg: 3.5 }] }), S)!.milkKg).toBe(0)
  })
})

describe('milkByDam', () => {
  it('summiert die Lämmer des letzten Wurfs je Mutter und zählt fehlende', () => {
    const lambs = [
      lamb({ key: 'a', weights: [{ date: '2026-01-22', kg: 9 }] }),
      lamb({ key: 'b', weights: [{ date: '2026-01-22', kg: 8 }] }),
      lamb({ key: 'c' }),
      lamb({ key: 'alt', birthDate: '2025-06-01', weights: [{ date: '2025-06-22', kg: 20 }] }),
    ]
    const m = milkByDam(lambs, S).get('m1')!
    expect(m.lambs).toBe(2)
    expect(m.missing).toBe(1)
    expect(m.totalKg).toBeCloseTo(25 + 20, 5)
  })
})

describe('sucklingMilkByDam', () => {
  it('ohne Wägung nach Vorgabe je Anzahl: 1 → 1.5, 2 → 2.5, 3 → 3 kg/Tag', () => {
    const one = sucklingMilkByDam([lamb({ key: 'a', birthWeight: null })], S).get('m1')!
    expect(one).toMatchObject({ lambs: 1, perDay: 1.5, weighed: 0, bucket: 0 })
    const two = sucklingMilkByDam([lamb({ key: 'a', birthWeight: null }), lamb({ key: 'b', birthWeight: null })], S).get('m1')!
    expect(two.perDay).toBe(2.5)
    const three = sucklingMilkByDam(['a', 'b', 'c'].map((k) => lamb({ key: k, birthWeight: null })), S).get('m1')!
    expect(three.perDay).toBe(3)
  })

  it('Lamm am Eimer zählt nicht; nur Eimer-Lämmer = keine Korrektur', () => {
    const m = sucklingMilkByDam([lamb({ key: 'a', birthWeight: null }), lamb({ key: 'b', birthWeight: null, bucketFrom: '2026-01-05', suckling: false })], S).get('m1')!
    expect(m).toMatchObject({ lambs: 1, bucket: 1, perDay: 1.5 })
    const only = sucklingMilkByDam([lamb({ birthWeight: null, bucketFrom: '2026-01-05', suckling: false })], S).get('m1')!
    expect(only).toMatchObject({ lambs: 0, bucket: 1, perDay: 0 })
  })

  it('mit Wägung aus dem Zuwachs, das andere Lamm nach Vorgabe (Anteil am Wurf)', () => {
    // 5 kg in 21 Tagen × 5 = 25 kg → 1.19 kg/Tag; Zwilling ohne Wägung 2.5 / 2
    const m = sucklingMilkByDam([lamb({ key: 'a', weights: [{ date: '2026-01-22', kg: 9 }] }), lamb({ key: 'b', birthWeight: null })], S).get('m1')!
    expect(m.weighed).toBe(1)
    expect(m.perDay).toBeCloseTo(25 / 21 + 1.25, 2)
  })

  it('abgesetzte Lämmer gehören nicht mehr dazu', () => {
    expect(sucklingMilkByDam([lamb({ nursing: false, suckling: false, weanDate: '2026-01-15' })], S).get('m1')).toBeUndefined()
  })
})
