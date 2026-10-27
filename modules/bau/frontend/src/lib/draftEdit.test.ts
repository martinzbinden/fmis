import { describe, expect, it } from 'vitest'
import { insertAt, insertIndex, removeAt } from './draftEdit'

const line = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
]

describe('insertIndex', () => {
  it('fügt im nächstgelegenen Stück ein', () => {
    expect(insertIndex(line, { x: 50, y: 3 }, false)).toBe(1)
    expect(insertIndex(line, { x: 97, y: 60 }, false)).toBe(2)
  })
  it('kennt bei Flächen das Schlussstück', () => {
    expect(insertIndex(line, { x: 48, y: 52 }, true)).toBe(3)
    expect(insertIndex(line, { x: 48, y: 52 }, false)).not.toBe(3)
  })
})

describe('insertAt / removeAt', () => {
  it('fügt an der Stelle ein', () => {
    expect(insertAt([[0, 0], [2, 2]], 1, [1, 1])).toEqual([[0, 0], [1, 1], [2, 2]])
  })
  it('löscht nur, solange genug Punkte bleiben', () => {
    expect(removeAt([[0, 0], [1, 1], [2, 2]], 1, 'LineString')).toEqual([[0, 0], [2, 2]])
    expect(removeAt([[0, 0], [2, 2]], 0, 'LineString')).toBeNull()
    expect(removeAt([[0, 0], [1, 0], [1, 1]], 0, 'Polygon')).toBeNull()
    expect(removeAt([[0, 0]], 0, 'Point')).toBeNull()
  })
})
