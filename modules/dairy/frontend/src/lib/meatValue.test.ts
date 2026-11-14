import { describe, expect, it } from 'vitest'
import { DEFAULT_MEAT_SETTINGS as S, FALLBACK_MEAT_PRICES as P, meatValue, sumMeat } from './meatValue'

describe('meatValue', () => {
  it('Lamm unter 420 Tagen: Lammpreis, Gewicht nach Alter, Abzüge', () => {
    const v = meatValue('2026-01-31', '2026-11-26', S, P)! // 299 Tage
    expect(v.kind).toBe('Lamm')
    expect(v.kg).toBe(S.lambKgOld)
    expect(v.gross).toBeCloseTo(13.2 * 13.4 * 0.95, 5)
    expect(v.net).toBeCloseTo(v.gross - 3.68 - 7.5, 5)
  })
  it('420 Tage: ab dann Schafpreis (Lamm-Grenze)', () => {
    expect(meatValue('2025-10-02', '2026-11-26', S, P)!.kind).toBe('Schaf') // 420 Tage
    expect(meatValue('2025-10-03', '2026-11-26', S, P)!.kind).toBe('Lamm') // 419 Tage
  })
  it('Schaf: leichter unter 1400 Tagen', () => {
    expect(meatValue('2024-04-26', '2026-11-26', S, P)!.kg).toBe(S.sheepKgYoung)
    expect(meatValue('2022-01-30', '2026-11-26', S, P)!.kg).toBe(S.sheepKgOld)
  })
  it('ohne Geburtsdatum kein Wert; Summe zählt Unbekannte getrennt', () => {
    expect(meatValue(null, '2026-11-26', S, P)).toBeNull()
    const sum = sumMeat([meatValue('2026-01-31', '2026-11-26', S, P), meatValue('2022-01-30', '2026-11-26', S, P), null])
    expect(sum).toMatchObject({ lambs: 1, sheep: 1, unknown: 1 })
    expect(sum.net).toBeGreaterThan(0)
  })
})
