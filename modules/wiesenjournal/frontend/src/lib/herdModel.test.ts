import { describe, expect, it } from 'vitest'
import type { AnimalRef } from '@fmis/core/animals'
import { compositionAt, compositionText, defaultCategory, derivedWeideEntries } from './herdModel'
import type { HerdCount, HerdGroup, HerdMember, HerdStay } from '../types'

const base = { updated_at: '2026-10-03T00:00:00Z', deleted_at: null }
const group: HerdGroup = { id: 'g1', name: 'Schafe Wyden', species: 'schafe', milking: false, active: true, sort_order: 0, notes: null, ...base }
const counts: HerdCount[] = [
  { id: 'c1', group_id: 'g1', category: 'auen_galt', count: 11, from_date: '2026-09-20', to_date: null, notes: null, ...base },
  { id: 'c2', group_id: 'g1', category: 'jungschafe', count: 6, from_date: '2026-09-20', to_date: null, notes: null, ...base },
]
const members: HerdMember[] = Array.from({ length: 6 }, (_, i) => ({
  id: `m${i}`,
  group_id: 'g1',
  module_key: 'dairy_schafe',
  animal_id: `a${i}`,
  label: `21${i}`,
  category: 'auen_galt',
  from_date: '2026-10-03',
  to_date: null,
  ...base,
}))
const stays: HerdStay[] = [
  { id: 's1', group_id: 'g1', slot: 'weide', location_id: null, parcel_id: 'wyden', day_only: false, from_date: '2026-09-20', to_date: null, notes: null, ...base },
  { id: 's2', group_id: 'g1', slot: 'stall', location_id: 'schopf', parcel_id: null, day_only: false, from_date: '2026-09-20', to_date: null, notes: null, ...base },
]

describe('herdModel', () => {
  it('Bestand: Einzeltiere und Tiere ohne Nummer zusammen', () => {
    expect(compositionAt('g1', members, counts, '2026-10-02').total).toBe(17)
    const today = compositionAt('g1', members, counts, '2026-10-03')
    expect(today.total).toBe(23)
    expect(compositionText(today)).toBe('17 Auen galt (6 mit Nr.) · 6 Jungschafe')
  })

  it('Weide im Raster je Tag aus dem Aufenthalt, Stall zählt nicht', () => {
    const entries = derivedWeideEntries([group], stays, members, counts, '2026-10-02', '2026-10-03')
    expect(entries.map((e) => [e.entry_date, e.parcel_id, e.animal_category, e.animal_count])).toEqual([
      ['2026-10-02', 'wyden', 'schafe', 17],
      ['2026-10-03', 'wyden', 'schafe', 23],
    ])
  })

  it('offene Weide nur bis heute, nicht in die Zukunft', () => {
    const entries = derivedWeideEntries([group], stays, members, counts, '2026-10-01', '2026-10-31', '2026-10-03')
    expect(entries.map((e) => e.entry_date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })

  it('Kategorie-Vorschlag', () => {
    const ewe = { species: 'schafe', sex: 'w', parity: 3, birth_date: '2021-01-01' } as AnimalRef
    expect(defaultCategory(ewe, true, '2026-10-03')).toBe('auen_gemolken')
    expect(defaultCategory(ewe, false, '2026-10-03')).toBe('auen_galt')
    expect(defaultCategory({ ...ewe, dry: true }, true, '2026-10-03')).toBe('auen_galt')
    expect(defaultCategory({ ...ewe, parity: 0, birth_date: '2025-03-01' }, false, '2026-10-03')).toBe('jungschafe')
    expect(defaultCategory({ ...ewe, birth_date: '2026-06-01', parity: 0 }, false, '2026-10-03')).toBe('laemmer')
    const cow = { species: 'rinder', sex: 'w', parity: 2, birth_date: '2020-01-01' } as AnimalRef
    expect(defaultCategory(cow, false, '2026-10-03')).toBe('galtkuehe')
  })
})
