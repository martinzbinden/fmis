import { describe, expect, it } from 'vitest'
import { animalDeleteBlocker, closeMemberships, groupDeleteBlocker } from './groups'
import type { GroupMembership } from '../types'

const gm = (p: Partial<GroupMembership>): GroupMembership => ({
  id: 'm1',
  animal_id: 'a1',
  group_id: 'g1',
  start_date: '2026-05-01',
  end_date: null,
  updated_at: '2026-05-01T00:00:00Z',
  deleted_at: null,
  ...p,
})

describe('Mitgliedschaften beenden', () => {
  it('beendet nur offene, nicht gelöschte Mitgliedschaften', () => {
    const out = closeMemberships(
      [gm({ id: 'offen' }), gm({ id: 'zu', end_date: '2026-06-01' }), gm({ id: 'weg', deleted_at: '2026-06-02T00:00:00Z' })],
      '2026-09-03',
    )
    expect(out.map((m) => [m.id, m.end_date])).toEqual([['offen', '2026-09-03']])
  })

  it('setzt das Ende nie vor den Start, auch bei Date aus pglite', () => {
    const out = closeMemberships([gm({ start_date: new Date('2026-10-01T00:00:00Z') as unknown as string })], '2026-09-03')
    expect(out[0].end_date).toBe('2026-10-01')
  })
})

describe('Löschen nur ohne abhängige Einträge', () => {
  it('Tier', () => {
    expect(animalDeleteBlocker({ weighings: 0, medications: 0, slaughter: 0 })).toBeNull()
    const msg = animalDeleteBlocker({ weighings: 3, medications: 0, slaughter: 1 })
    expect(msg).toContain('3 Wägung(en)')
    expect(msg).toContain('Status')
  })

  it('Gruppe', () => {
    expect(groupDeleteBlocker({ feed: 0, expenses: 0, memberships: 0 })).toBeNull()
    expect(groupDeleteBlocker({ feed: 2, expenses: 0, memberships: 5 })).toContain('abgeschlossen')
  })
})
