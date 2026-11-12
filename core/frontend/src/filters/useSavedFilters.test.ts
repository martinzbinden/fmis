import { describe, expect, it } from 'vitest'
import { nextMode, parseFilterState, presetFilter } from './useSavedFilters'

describe('nextMode', () => {
  it('aus → einfärben → nur zeigen → aus', () => {
    expect(nextMode(undefined)).toBe('color')
    expect(nextMode('off')).toBe('color')
    expect(nextMode('color')).toBe('only')
    expect(nextMode('only')).toBe('off')
  })
})

describe('parseFilterState', () => {
  const good = { id: 'a', name: 'Test', color: 'rot', match: 'all', conditions: [{ field: 'age', op: 'gt', value: '5' }] }

  it('liest gespeicherte Filter und Modi', () => {
    const s = parseFilterState(JSON.stringify({ custom: [good], modes: { a: 'only' } }))
    expect(s.custom).toHaveLength(1)
    expect(s.modes).toEqual({ a: 'only' })
  })

  it('lässt Unlesbares und Ungültiges weg', () => {
    expect(parseFilterState(null)).toEqual({ custom: [], modes: {} })
    expect(parseFilterState('kein json')).toEqual({ custom: [], modes: {} })
    const s = parseFilterState(JSON.stringify({ custom: [good, { id: 'b' }, { ...good, id: 'c', match: 'xyz' }, { ...good, id: 'd', conditions: [{}] }], modes: { a: 'bogus', b: 'color' } }))
    expect(s.custom.map((f) => f.id)).toEqual(['a'])
    expect(s.modes).toEqual({ b: 'color' })
  })

  it('gespeicherte Filter sind nie Vorlagen', () => {
    const s = parseFilterState(JSON.stringify({ custom: [{ ...good, preset: true }], modes: {} }))
    expect(s.custom[0].preset).toBeUndefined()
  })
})

describe('presetFilter', () => {
  it('markiert Vorlagen und prüft Operationen', () => {
    expect(presetFilter('p', 'P', 'rot', 'all', [{ field: 'x', op: 'yes' }]).preset).toBe(true)
    expect(() => presetFilter('p', 'P', 'rot', 'all', [{ field: 'x', op: 'kaputt' as never }])).toThrow()
  })
})
