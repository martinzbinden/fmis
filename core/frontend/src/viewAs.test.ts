import { describe, expect, it } from 'vitest'
import { parseViewAs, VIEW_AS_IDLE_MS } from './viewAs'

const saved = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ email: 'anna@riedackerhof.ch', role: 'Mitarbeiter', permissions: ['betrieb:dienste:read'], lastActive: 1_000_000, ...over })

describe('parseViewAs', () => {
  it('liest eine gültige Ansicht', () => {
    expect(parseViewAs(saved(), 1_000_000 + 60_000)).toEqual({
      email: 'anna@riedackerhof.ch',
      role: 'Mitarbeiter',
      permissions: ['betrieb:dienste:read'],
      lastActive: 1_000_000,
    })
  })

  it('kehrt nach 20 Minuten ohne Bedienung zurück (null)', () => {
    expect(parseViewAs(saved(), 1_000_000 + VIEW_AS_IDLE_MS)).not.toBeNull()
    expect(parseViewAs(saved(), 1_000_000 + VIEW_AS_IDLE_MS + 1)).toBeNull()
  })

  it('ignoriert fehlenden oder beschädigten Speicher', () => {
    expect(parseViewAs(null, 0)).toBeNull()
    expect(parseViewAs('{kaputt', 0)).toBeNull()
    expect(parseViewAs(saved({ permissions: 'alle' }), 1_000_000)).toBeNull()
    expect(parseViewAs(saved({ lastActive: 'gestern' }), 1_000_000)).toBeNull()
  })
})
