import { describe, expect, it } from 'vitest'
import { DEFECTS, isAbort, LOSS_GROUPS, lossLabel, parseDefects, toggleDefect } from './lambLoss'

describe('Ursachen bei toten Jungtieren', () => {
  it('hat eindeutige Schlüssel', () => {
    const keys = [...LOSS_GROUPS.flatMap((g) => g.items), ...DEFECTS].map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('zeigt die Bezeichnung und bleibt bei Unbekanntem lesbar', () => {
    expect(lossLabel('fehllage')).toBe('Fehllage')
    expect(lossLabel('alt')).toBe('alt')
    expect(lossLabel(null)).toBeNull()
  })
  it('schaltet Gebrechen ein und aus', () => {
    expect(toggleDefect([], 'kiefer')).toBe('kiefer')
    expect(toggleDefect(['kiefer'], 'herz')).toBe('kiefer,herz')
    expect(toggleDefect(['kiefer', 'herz'], 'kiefer')).toBe('herz')
    expect(parseDefects('kiefer,herz')).toEqual(['kiefer', 'herz'])
    expect(parseDefects(null)).toEqual([])
  })
  it('erkennt den Abort', () => {
    expect(isAbort('abort')).toBe(true)
    expect(isAbort('faul')).toBe(false)
  })
})
