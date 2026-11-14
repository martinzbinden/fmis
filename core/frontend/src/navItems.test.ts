import { describe, expect, it } from 'vitest'
import { navIsActive, resolveNav } from './navItems'

describe('navIsActive', () => {
  it('start page only when exactly at the root', () => {
    expect(navIsActive('', { to: '' })).toBe(true)
    expect(navIsActive('tiere', { to: '' })).toBe(false)
  })
  it('own path, subpaths and the other views of a switch', () => {
    const item = { to: 'tiere', also: ['tierinfo'] }
    expect(navIsActive('tiere', item)).toBe(true)
    expect(navIsActive('tiere/abc', item)).toBe(true)
    expect(navIsActive('tierinfo', item)).toBe(true)
    expect(navIsActive('tiere-neu', item)).toBe(false)
    expect(navIsActive('gruppen', item)).toBe(false)
  })
})

describe('resolveNav', () => {
  it('replaces dynamic items and keeps the others', () => {
    const items = [
      { to: '', label: 'Heute', icon: 'H' },
      { to: 'geburt', label: 'Erfassen', icon: 'E', resolve: () => ({ to: 'klauen', label: 'Klauen', icon: 'K' }) },
    ]
    expect(resolveNav(items).map((i) => i.to)).toEqual(['', 'klauen'])
  })
  it('falls back to the fixed item when resolve throws', () => {
    const items = [{ to: 'geburt', label: 'Erfassen', icon: 'E', resolve: () => { throw new Error('x') } }]
    expect(resolveNav(items)[0].to).toBe('geburt')
  })
})
