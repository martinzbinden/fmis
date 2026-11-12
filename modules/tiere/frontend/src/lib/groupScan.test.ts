import { describe, expect, it } from 'vitest'
import type { AnimalRef } from '@fmis/core/animals'
import { majoritySpecies, planSave, resolveTags, toProposal } from './groupScan'
import type { HerdData } from './herds'
import type { HerdGroup, HerdMember } from '../types'

const animal = (id: string, ear_tag: string, species: 'schafe' | 'rinder' = 'schafe'): AnimalRef => ({
  moduleKey: 'dairy_schafe',
  id,
  ear_tag,
  lauf_nr: null,
  name: null,
  label: id,
  sex: 'w',
  birth_date: null,
  species,
  parity: 0,
})

const animals = [animal('a', 'CH113900000103'), animal('b', 'CH113900000114'), animal('c', 'CH120900000203', 'rinder')]

describe('resolveTags', () => {
  it('ordnet Gerätenummern den Tieren zu, Schaf wie Rind', () => {
    const r = resolveTags(['CH000090000010', 'CH120900000203', 'CH000090000999'], animals)
    expect(r.matched.map((m) => m.animal.id)).toEqual(['a', 'c'])
    expect(r.unknown).toEqual(['CH000090000999'])
  })
  it('ein Tier zählt einmal, auch bei zwei Lesungen', () => {
    const r = resolveTags(['CH000090000010', 'CH113900000103', 'CH000090000010'], animals)
    expect(r.matched).toHaveLength(1)
    expect(r.unknown).toEqual([])
  })
})

describe('majoritySpecies', () => {
  it('häufigste Tierart, bei Gleichstand Schafe', () => {
    expect(majoritySpecies([animals[0], animals[1], animals[2]])).toBe('schafe')
    expect(majoritySpecies([animals[2]])).toBe('rinder')
    expect(majoritySpecies([animals[0], animals[2]])).toBe('schafe')
  })
})

const group = (id: string, name: string): HerdGroup => ({ id, name, species: 'schafe', milking: false, active: true, sort_order: 10, notes: null, updated_at: '', deleted_at: null })
const member = (id: string, group_id: string, animal_id: string, from_date = '2026-01-01', to_date: string | null = null): HerdMember => ({
  id,
  group_id,
  module_key: 'dairy_schafe',
  animal_id,
  label: animal_id,
  category: 'mutterschaf',
  from_date,
  to_date,
  updated_at: '',
  deleted_at: null,
})
const data = (members: HerdMember[]): HerdData => ({ locations: [], groups: [group('g1', 'Weide'), group('g2', 'Stall')], stays: [], members, counts: [], laufhof: [], parcels: [] })

describe('planSave', () => {
  const date = '2026-11-12'
  it('neue Gruppe: alle kommen dazu, Herkunft wird gemeldet', () => {
    const d = data([member('m1', 'g2', 'a')])
    const p = planSave(d, null, [animals[0], animals[1]], date, false)
    expect(p.add.map((a) => a.id)).toEqual(['a', 'b'])
    expect(p.moving.map((m) => [m.animal.id, m.from.name])).toEqual([['a', 'Stall']])
    expect(p.leaving).toEqual([])
  })

  it('ersetzen: wer nicht gelesen wurde, verlässt die Gruppe; wer schon drin ist, bleibt', () => {
    const d = data([member('m1', 'g1', 'a'), member('m2', 'g1', 'b'), member('m3', 'g1', 'x')])
    const p = planSave(d, d.groups[0], [animals[0]], date, true)
    expect(p.stay.map((a) => a.id)).toEqual(['a'])
    expect(p.add).toEqual([])
    expect(p.leaving.map((m) => m.animal_id).sort()).toEqual(['b', 'x'])
  })

  it('dazunehmen: niemand verlässt die Gruppe', () => {
    const d = data([member('m1', 'g1', 'x')])
    const p = planSave(d, d.groups[0], [animals[0]], date, false)
    expect(p.leaving).toEqual([])
    expect(p.add.map((a) => a.id)).toEqual(['a'])
  })

  it('beendete Zugehörigkeit zählt nicht', () => {
    const d = data([member('m1', 'g2', 'a', '2026-01-01', '2026-06-30')])
    expect(planSave(d, null, [animals[0]], date, false).moving).toEqual([])
  })
})

describe('toProposal', () => {
  it('liest Listen aus dem Text und überlebt kaputten Text', () => {
    const p = toProposal({ id: 'x', device_group_id: '1', name: 'Weide', device_count: 2, tag_count: 2, tags: '["CH000090000010"]', unmatched: 'kaputt', fetched_at: '2026-11-12T08:00:00Z', scanned_at: '2026-04-18T00:42:16Z', status: 'neu' })
    expect(p.tags).toEqual(['CH000090000010'])
    expect(p.unmatched).toEqual([])
    expect(p.status).toBe('neu')
    expect(p.scanned_at).toBe('2026-04-18T00:42:16Z')
  })
})
