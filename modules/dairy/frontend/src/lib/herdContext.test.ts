import { describe, expect, it } from 'vitest'
import { litterSummary, type OffspringRow } from './herdContext'

const o = (dead = false): OffspringRow => ({ id: '', ear_tag: null, sex: null, stillborn: dead, died_24h: false, died_on: null, birth_weight_kg: null })

describe('litterSummary', () => {
  it('Wurfgrössen chronologisch, Mittel inkl. und ohne tot geborene', () => {
    const r = litterSummary([
      { birth_date: '2025-01-10', offspring: [o(), o(), o(true)] },
      { birth_date: '2024-01-10', offspring: [o()] },
      { birth_date: '2026-01-10', offspring: [] },
    ])
    expect(r.sizes).toEqual([1, 3])
    expect(r.mean).toBe(2)
    expect(r.aliveMean).toBe(1.5)
  })
  it('ohne Geburten', () => {
    expect(litterSummary([])).toEqual({ sizes: [], mean: null, aliveMean: null })
  })
})
