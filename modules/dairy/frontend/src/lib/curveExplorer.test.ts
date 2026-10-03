import { describe, expect, it } from 'vitest'
import { meanOf, smoothAt } from './curveExplorer'

const line = [
  { dim: 20, value: 100 },
  { dim: 50, value: 90 },
  { dim: 80, value: 80 },
  { dim: 110, value: 70 },
]

describe('curveExplorer', () => {
  it('nahe an einer Wägung: deren Wert, als gemessen', () => {
    expect(smoothAt(line, 52)).toEqual({ value: 90, measured: true })
  })

  it('zwischen Wägungen: folgt einer Geraden exakt', () => {
    const e = smoothAt(line, 65)!
    expect(e.measured).toBe(false)
    expect(e.value).toBeCloseTo(85, 5)
  })

  it('glättet einen Ausreisser', () => {
    const noisy = [...line.slice(0, 2), { dim: 80, value: 120 }, line[3]]
    const e = smoothAt(noisy, 70)!
    expect(e.value).toBeGreaterThan(85)
    expect(e.value).toBeLessThan(120)
  })

  it('kleiner Rand, keine Hochrechnung weit über die Wägungen hinaus', () => {
    expect(smoothAt(line, 120)).not.toBeNull()
    expect(smoothAt(line, 140)).toBeNull()
    expect(smoothAt(line, 5)).toBeNull()
    expect(smoothAt([], 50)).toBeNull()
  })

  it('eine einzige Wägung: deren Wert in der Nähe', () => {
    expect(smoothAt([{ dim: 40, value: 77 }], 48)).toEqual({ value: 77, measured: false })
  })

  it('Mittel ohne fehlende Werte', () => {
    expect(meanOf([80, null, 100, undefined])).toBe(90)
    expect(meanOf([null])).toBeNull()
  })
})
