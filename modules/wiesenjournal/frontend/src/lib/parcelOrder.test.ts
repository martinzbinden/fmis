import { describe, expect, it } from 'vitest'
import { moveParcel } from './parcelOrder'

const p = (id: string, sort_order: number | null, name = id) => ({ id, name, sort_order })

describe('Eigene Reihenfolge der Parzellen', () => {
  it('schiebt eine Parzelle nach oben und nummeriert neu', () => {
    const all = [p('a', 0), p('b', 1), p('c', 2)]
    expect(moveParcel(all, 'c', 'b', 'up')).toEqual([
      { id: 'c', sort_order: 1 },
      { id: 'b', sort_order: 2 },
    ])
  })
  it('kommt mit gleichen oder fehlenden Werten zurecht', () => {
    const all = [p('x', 0, 'Zelg'), p('y', 0, 'Acker'), p('z', null, 'Bach')]
    // Reihenfolge vorher: Acker (y), Zelg (x), Bach (z)
    expect(moveParcel(all, 'y', 'x', 'down')).toEqual([
      { id: 'y', sort_order: 1 },
      { id: 'z', sort_order: 2 },
    ])
  })
  it('springt über ausgeblendete Parzellen zum sichtbaren Nachbarn', () => {
    const all = [p('a', 0), p('h', 1), p('b', 2)]
    expect(moveParcel(all, 'b', 'a', 'up')).toEqual([
      { id: 'b', sort_order: 0 },
      { id: 'a', sort_order: 1 },
      { id: 'h', sort_order: 2 },
    ])
  })
})
