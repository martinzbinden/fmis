import { describe, expect, it } from 'vitest'
import { duplicateEntries, type WatchlistEntry } from './watchlists'

const e = (id: string, animal: string, added: string, extra: Partial<WatchlistEntry> = {}): WatchlistEntry => ({
  id,
  list_id: 'L',
  animal_id: animal,
  reason: null,
  added_by: null,
  added_at: added,
  done_at: null,
  ...extra,
})

describe('duplicateEntries', () => {
  it('behält je Tier den ältesten offenen Eintrag', () => {
    const d = duplicateEntries([e('b', 'A', '2026-10-31T15:33:29Z'), e('a', 'A', '2026-10-31T15:33:28Z'), e('c', 'B', '2026-10-31T15:33:30Z')])
    expect(d).toHaveLength(1)
    expect(d[0].keep.id).toBe('a')
    expect(d[0].drop.map((x) => x.id)).toEqual(['b'])
  })

  it('übernimmt die Gründe der entfernten Einträge', () => {
    const d = duplicateEntries([e('a', 'A', '2026-10-01', { reason: 'Klauen' }), e('b', 'A', '2026-10-02', { reason: 'Zellzahl' })])
    expect(d[0].keep.reason).toBe('Klauen; Zellzahl')
  })

  it('erledigte Einträge und andere Listen zählen nicht', () => {
    expect(duplicateEntries([e('a', 'A', '2026-10-01', { done_at: '2026-10-05' }), e('b', 'A', '2026-10-06')])).toEqual([])
    expect(duplicateEntries([e('a', 'A', '2026-10-01'), e('b', 'A', '2026-10-01', { list_id: 'M' })])).toEqual([])
  })
})
