import { describe, expect, it } from 'vitest'
import { DEFAULT_MEAT_SETTINGS, MEAT_BAR_MAX, meatBarColor, meatBarPercent, meatLimits } from './meatValue'

describe('meat bar scale', () => {
  it('uses a fixed scale up to 330 Fr., independent of the other animals', () => {
    expect(MEAT_BAR_MAX).toBe(330)
    expect(meatBarPercent(165)).toBeCloseTo(50, 5)
    expect(meatBarPercent(400)).toBe(100)
    expect(meatBarPercent(0)).toBe(3)
  })

  it('color goes from orange (little) to green (much)', () => {
    const hue = (c: string) => Number(/hsl\((\d+)/.exec(c)![1])
    expect(hue(meatBarColor(0))).toBeLessThan(hue(meatBarColor(165)))
    expect(hue(meatBarColor(165))).toBeLessThan(hue(meatBarColor(330)))
    expect(hue(meatBarColor(1000))).toBe(hue(meatBarColor(330)))
  })
})

describe('meatLimits', () => {
  const s = DEFAULT_MEAT_SETTINGS
  it('heavy ewe and heavy lamb T3 are always there, H3 and C3 only with a known price', () => {
    expect(meatLimits(s, { lamb: 13.4, sheep: 6.3 }).map((l) => l.key)).toEqual(['aue', 't3'])
    expect(meatLimits(s, { lamb: 13.4, sheep: 6.3, lambH: 13.8, lambC: 14.1 }).map((l) => l.key)).toEqual(['aue', 't3', 'h3', 'c3'])
  })
  it('computes 21 kg SG x price x factor minus fees, and rises from T3 to C3', () => {
    const [aue, t3, h3, c3] = meatLimits(s, { lamb: 13.4, sheep: 6.3, lambH: 13.8, lambC: 14.1 })
    expect(t3.net).toBeCloseTo(21 * 13.4 * s.lambFactor - s.feePerAnimal - s.transportPerAnimal, 6)
    expect(aue.net).toBeCloseTo(36 * 6.3 * s.sheepFactor - s.feePerAnimal - s.transportPerAnimal, 6)
    expect(t3.net).toBeLessThan(h3.net)
    expect(h3.net).toBeLessThan(c3.net)
  })
})
