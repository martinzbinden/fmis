import { describe, expect, it } from 'vitest'
import { appendOlder, type HistoryEntry } from './historyApi'

const e = (id: string, changed_at: string): HistoryEntry => ({
  id,
  table_name: 'parcels',
  row_id: 'r1',
  action: 'update',
  changed_by: null,
  changed_at,
  snapshot: '{}',
  updated_at: changed_at,
})

describe('Verlauf nachladen', () => {
  it('hängt ältere Einträge ohne Doppelte an', () => {
    const cur = [e('a', '2026-03-02T10:00:00Z'), e('b', '2026-03-01T10:00:00Z')]
    const older = [e('b', '2026-03-01T10:00:00Z'), e('c', '2026-02-28T10:00:00Z')]
    expect(appendOlder(cur, older).map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
})
