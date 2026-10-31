import { describe, expect, it } from 'vitest'
import { undoPlan } from './HistoryUndoButton'

const h = (id: string, at: string, snap: Record<string, unknown>) => ({ id, changed_at: at, snapshot: JSON.stringify(snap) })

describe('undoPlan', () => {
  const rows = [h('1', '2026-10-01T10:00:00Z', { name: 'A' }), h('2', '2026-10-02T10:00:00Z', { name: 'B' }), h('3', '2026-10-03T10:00:00Z', { name: 'C', deleted_at: '2026-10-03' })]

  it('Änderung → Stand davor, spätere Änderungen werden gezählt', () => {
    expect(undoPlan({ id: '2', action: 'update' }, rows)).toEqual({ state: { name: 'A', deleted_at: null }, later: 1 })
  })
  it('Löschen → Stand davor (wieder sichtbar)', () => {
    expect(undoPlan({ id: '3', action: 'delete' }, rows)).toEqual({ state: { name: 'B', deleted_at: null }, later: 0 })
  })
  it('Neu → löschen', () => {
    expect(undoPlan({ id: '1', action: 'insert' }, rows)).toEqual({ state: null, later: 2 })
  })
  it('ohne Vorgänger kein Rückgängig', () => {
    expect(undoPlan({ id: '1', action: 'update' }, rows)).toHaveProperty('error')
  })
})
