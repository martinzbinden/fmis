import { describe, expect, it } from 'vitest'
import { captureEntries } from './CaptureMenu'

const keys = (e: { key: string }[]) => e.map((x) => x.key)

describe('Erfassen-Menü in der Tier-Info', () => {
  it('Kuh: Geburt, Belegung, Trächtigkeit, Gewicht und CH-TAX, alle mit dem Tier', () => {
    const e = captureEntries({ id: 'a1', sex: 'w' }, false, null, 0)
    expect(keys(e)).toEqual(expect.arrayContaining(['behandlung', 'geburt', 'belegung', 'traechtigkeit', 'klauen', 'gewicht', 'chtax']))
    for (const x of e.filter((x) => x.to && !x.to.startsWith('laemmer'))) expect(x.to).toContain('tier=a1')
    expect(e.find((x) => x.key === 'behandlung')?.to).toBe('journal?tier=a1&art=behandlung')
  })
  it('Widder: keine Geburt/Trächtigkeit, kein Schlachtwert beim Schaf', () => {
    const e = keys(captureEntries({ id: 'b2', sex: 'm' }, true, null, 0))
    expect(e).not.toContain('geburt')
    expect(e).not.toContain('traechtigkeit')
    expect(e).not.toContain('chtax')
  })
  it('Mutter mit saugenden Lämmern und saugendes Lamm: absetzen', () => {
    expect(captureEntries({ id: 'c3', sex: 'w' }, true, null, 2).find((x) => x.key === 'absetzen')?.to).toBe('laemmer?aktion=absetzen&mutter=c3')
    const lamb = captureEntries({ id: 'd4', sex: 'w' }, true, { nursing: true }, 0)
    expect(keys(lamb)).toEqual(expect.arrayContaining(['waegen', 'absetzen']))
    expect(keys(lamb)).not.toContain('geburt')
  })
})
