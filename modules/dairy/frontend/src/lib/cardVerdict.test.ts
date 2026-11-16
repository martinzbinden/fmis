import { describe, expect, it } from 'vitest'
import { cardVerdict, moneyBalance } from './cardVerdict'
import type { CullingReason } from './culling'

const r = (weight: number): CullingReason => ({ area: 'euter', weight, text: 'Testgrund' })
const base = { reasons: [], pregnancy: null, balance: null, frPerPoint: 100, ageMonths: 40, parity: 2, today: '2026-11-16' }

describe('cardVerdict', () => {
  it('ohne Gründe: behalten', () => {
    expect(cardVerdict(base).verdict).toBe('behalten')
  })
  it('Gründe, frisch leer und Verlust bis zur Geburt: rot', () => {
    const v = cardVerdict({ ...base, reasons: [r(2), r(1)], pregnancy: { result: 'nein', date: '2026-11-13', examiner: null, method: 'ultraschall', weeks: null }, balance: -140 })
    expect(v.points).toBe(3 + 3 + 1)
    expect(v.verdict).toBe('ausmerzen')
    expect(v.parts.map((p) => p.label)).toEqual(['Ausmerzgründe', 'Trächtigkeit', 'Milch gegen Futter'])
  })
  it('trächtig zieht weit nach unten', () => {
    const v = cardVerdict({ ...base, reasons: [r(2), r(2)], pregnancy: { result: 'ja', date: '2026-11-13', examiner: null, method: 'ultraschall', weeks: 10 } })
    expect(v.points).toBe(0)
    expect(v.verdict).toBe('behalten')
  })
  it('zwei bis vier Punkte: beobachten', () => {
    expect(cardVerdict({ ...base, reasons: [r(2)] }).verdict).toBe('beobachten')
  })
  it('Jungtier ohne Gründe: grau', () => {
    expect(cardVerdict({ ...base, parity: 0, ageMonths: 8 }).verdict).toBe('jung')
    expect(cardVerdict({ ...base, parity: 0, ageMonths: 8, reasons: [r(3)] }).verdict).toBe('beobachten')
  })
})

describe('moneyBalance', () => {
  it('Schlachtwert gegen Milch minus Futter', () => {
    expect(moneyBalance(146, -140)).toEqual({ slaughter: 146, keep: -140, diff: 286 })
    expect(moneyBalance(146, null)).toBeNull()
  })
})
