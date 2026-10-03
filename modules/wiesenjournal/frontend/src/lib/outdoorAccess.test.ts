import { describe, expect, it } from 'vitest'
import { accessIndex, categoryDay, categoryMark, monthCounter, type AccessInput } from './outdoorAccess'
import type { HerdGroup, HerdStay } from '../types'

const base = { updated_at: '2026-10-03T00:00:00Z', deleted_at: null }
const g = (id: string, name: string, species: 'schafe' | 'rinder'): HerdGroup => ({ id, name, species, milking: false, active: true, sort_order: 0, notes: null, ...base })
const stay = (id: string, group_id: string, slot: 'stall' | 'weide', place: string, from: string, to: string | null = null): HerdStay => ({
  id,
  group_id,
  slot,
  location_id: slot === 'stall' ? place : null,
  parcel_id: slot === 'weide' ? place : null,
  day_only: false,
  from_date: from,
  to_date: to,
  notes: null,
  ...base,
})

const input: AccessInput = {
  groups: [g('kuehe', 'Milchkühe', 'rinder'), g('schafe', 'Melkherde', 'schafe'), g('jung', 'Jungvieh', 'rinder')],
  stays: [
    stay('s1', 'kuehe', 'stall', 'kuhstall', '2026-10-01'),
    stay('s2', 'schafe', 'stall', 'melkstall', '2026-10-01'),
    stay('s3', 'jung', 'stall', 'laufstall', '2026-10-01'),
    stay('s4', 'jung', 'weide', 'wyden', '2026-11-01', '2026-11-05'),
  ],
  members: [],
  counts: [
    { id: 'c1', group_id: 'kuehe', category: 'kuehe', count: 18, from_date: '2026-10-01', to_date: null, notes: null, ...base },
    { id: 'c2', group_id: 'kuehe', category: 'galtkuehe', count: 2, from_date: '2026-10-01', to_date: null, notes: null, ...base },
    { id: 'c3', group_id: 'schafe', category: 'auen_gemolken', count: 50, from_date: '2026-10-01', to_date: null, notes: null, ...base },
    { id: 'c4', group_id: 'jung', category: 'kuehe', count: 4, from_date: '2026-10-01', to_date: null, notes: null, ...base },
  ],
  locations: [
    { id: 'kuhstall', laufhof: 'zeitweise' },
    { id: 'melkstall', laufhof: 'staendig' },
    { id: 'laufstall', laufhof: 'zeitweise' },
  ],
  laufhof: [
    ...['2026-11-02', '2026-11-03', '2026-11-04'].map((d, i) => ({ id: `l${i}`, group_id: 'kuehe', entry_date: d, notes: null, ...base })),
    { id: 'lx', group_id: 'jung', entry_date: '2026-11-03', notes: null, ...base },
  ],
}

describe('outdoorAccess', () => {
  const idx = accessIndex(input)

  it('Weide vor Laufhof, ständiger Laufhof ohne Eintrag', () => {
    expect(idx.groupDay('schafe', '2026-11-10').kind).toBe('laufhof_staendig')
    expect(idx.groupDay('kuehe', '2026-11-02').kind).toBe('laufhof')
    expect(idx.groupDay('kuehe', '2026-11-05')).toMatchObject({ kind: null, stallLaufhof: 'zeitweise', animals: 20 })
    expect(idx.groupDay('jung', '2026-11-03')).toMatchObject({ kind: 'weide', laufhofEntry: true })
  })

  it('Winter-Zähler: 13 Auslauftage, noch erreichbar oder verfehlt', () => {
    const c = monthCounter(idx, 'kuehe', '2026-11', '2026-11-10')!
    expect(c).toMatchObject({ winter: true, done: 3, target: 13, present: 10 })
    // heute (10.) noch offen + 20 weitere Tage
    expect(c.possible).toBe(21)
    expect(c.state).toBe('offen')
    const late = monthCounter(idx, 'kuehe', '2026-11', '2026-11-25')!
    expect(late.state).toBe('verfehlt') // 3 + 6 < 13
    expect(monthCounter(idx, 'schafe', '2026-11', '2026-11-30')!.state).toBe('erfuellt')
    // vergangener Monat: nichts mehr möglich
    expect(monthCounter(idx, 'kuehe', '2026-11', '2026-12-05')).toMatchObject({ possible: 0, state: 'verfehlt' })
  })

  it('Sommer zählt nur Weidetage', () => {
    const c = monthCounter(idx, 'schafe', '2026-10', '2026-10-31')!
    expect(c).toMatchObject({ winter: false, done: 0, laufhof: 31, target: 26, state: 'verfehlt' })
  })

  it('Monat in der Zukunft oder ohne Tiere: kein Zähler', () => {
    expect(monthCounter(idx, 'kuehe', '2026-12', '2026-11-10')).toBeNull()
    expect(monthCounter(idx, 'kuehe', '2026-09', '2026-11-10')).toBeNull()
  })

  it('Tagesmeldung je Kategorie: alle, Teil, keine', () => {
    const d = categoryDay(idx, input, '2026-11-02')
    // Kühe: 18 im Laufhof (Milchkühe) + 4 auf der Weide (Jungvieh)
    expect(d.get('kuehe')).toMatchObject({ animals: 22, withAccess: 22 })
    expect(categoryMark(d.get('kuehe'))).toBe('✓')
    const d6 = categoryDay(idx, input, '2026-11-06')
    expect(categoryMark(d6.get('kuehe'))).toBeNull()
    const d5 = categoryDay(idx, input, '2026-11-05')
    expect(d5.get('kuehe')).toMatchObject({ animals: 22, withAccess: 4 })
    expect(categoryMark(d5.get('kuehe'))).toBe('◐')
    expect(categoryMark(d5.get('schafe'))).toBe('✓')
  })
})
