import { describe, expect, it } from 'vitest'
import { DEFAULT_MEAT_SETTINGS as S, FALLBACK_MEAT_PRICES as P, meatValue, sumMeat } from './meatValue'

describe('meatValue', () => {
  it('Lamm unter 420 Tagen: Lammpreis, Gewicht nach Alter, Abzüge', () => {
    const v = meatValue('2026-01-31', '2026-11-26', S, P)! // 299 Tage
    expect(v.kind).toBe('Lamm')
    expect(v.kg).toBe(S.lambKgOld)
    expect(v.gross).toBeCloseTo(20 * 13.4 * 0.95, 5)
    expect(v.net).toBeCloseTo(v.gross - 3.68 - 7.5, 5)
  })
  it('420 Tage: ab dann Schafpreis (Lamm-Grenze)', () => {
    expect(meatValue('2025-10-02', '2026-11-26', S, P)!.kind).toBe('Schaf') // 420 Tage
    expect(meatValue('2025-10-03', '2026-11-26', S, P)!.kind).toBe('Lamm') // 419 Tage
  })
  it('Schaf: nach Laktationstagen, frisch abgelammt leichter, ab 200 Tagen und ohne Ablammung schwer', () => {
    expect(meatValue('2022-01-30', '2026-11-26', S, P, '2026-11-26')!.kg).toBe(21)
    expect(meatValue('2022-01-30', '2026-11-26', S, P, '2026-08-18')!.kg).toBe(23) // 100 Tage
    expect(meatValue('2022-01-30', '2026-11-26', S, P, '2026-03-01')!.kg).toBe(25)
    expect(meatValue('2022-01-30', '2026-11-26', S, P)!.kg).toBe(S.sheepKgLate)
  })
  it('ohne Geburtsdatum kein Wert; Summe zählt Unbekannte getrennt', () => {
    expect(meatValue(null, '2026-11-26', S, P)).toBeNull()
    const sum = sumMeat([meatValue('2026-01-31', '2026-11-26', S, P), meatValue('2022-01-30', '2026-11-26', S, P), null])
    expect(sum).toMatchObject({ lambs: 1, sheep: 1, unknown: 1 })
    expect(sum.net).toBeGreaterThan(0)
  })
})

describe('Bereiche für die Grafik', () => {
  it('Lamm nach Alter, Schaf ein Bereich', () => {
    expect(meatValue('2026-11-01', '2026-11-26', S, P)!.band).toBe('lamm1')
    expect(meatValue('2026-06-01', '2026-11-26', S, P)!.band).toBe('lamm2')
    expect(meatValue('2026-01-31', '2026-11-26', S, P)!.band).toBe('lamm3')
    expect(meatValue('2022-01-30', '2026-11-26', S, P)!.band).toBe('schaf')
  })
  it('Summe je Bereich', () => {
    const sum = sumMeat([meatValue('2026-01-31', '2026-11-26', S, P), meatValue('2026-01-30', '2026-11-26', S, P), meatValue('2022-01-30', '2026-11-26', S, P)])
    expect(sum.byBand.lamm3.n).toBe(2)
    expect(sum.byBand.schaf.n).toBe(1)
    expect(sum.byBand.lamm1.n).toBe(0)
    expect(sum.byBand.lamm3.net + sum.byBand.schaf.net).toBeCloseTo(sum.net, 5)
  })
})

