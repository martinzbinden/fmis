import { describe, expect, it } from 'vitest'
import type { AnimalGroupPeriod } from './animals'
import { lastGroups } from './groupPeriods'

const p = (groupId: string, from: string, to: string | null, category = 'mutterschaf'): AnimalGroupPeriod => ({
  groupId,
  groupName: `Gruppe ${groupId}`,
  category,
  categoryLabel: category,
  from,
  to,
  places: [],
})

describe('lastGroups', () => {
  it('liefert die aktuelle und die vorherige Gruppe mit bis-Datum', () => {
    const h = [p('c', '2026-09-01', null), p('b', '2026-05-01', '2026-08-31'), p('a', '2026-01-01', '2026-04-30')]
    const out = lastGroups(h)
    expect(out.map((x) => x.groupId)).toEqual(['c', 'b'])
    expect(out[1].to).toBe('2026-08-31')
  })

  it('fasst aufeinanderfolgende Zeiten derselben Gruppe zusammen', () => {
    const h = [p('b', '2026-07-01', null, 'lamm'), p('b', '2026-05-01', '2026-06-30', 'mutterschaf'), p('a', '2026-01-01', '2026-04-30')]
    const out = lastGroups(h)
    expect(out.map((x) => x.groupId)).toEqual(['b', 'a'])
    expect(out[0].from).toBe('2026-05-01')
    expect(out[0].to).toBeNull()
  })

  it('ohne aktuelle Gruppe die zwei letzten vergangenen', () => {
    const h = [p('b', '2026-05-01', '2026-08-31'), p('a', '2026-01-01', '2026-04-30'), p('z', '2025-01-01', '2025-12-31')]
    expect(lastGroups(h).map((x) => x.groupId)).toEqual(['b', 'a'])
  })

  it('leerer Verlauf', () => {
    expect(lastGroups([])).toEqual([])
  })
})
