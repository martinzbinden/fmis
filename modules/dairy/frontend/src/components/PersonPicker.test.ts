import { describe, expect, it } from 'vitest'
import { personOptions } from './PersonPicker'

describe('Schnellauswahl Ausführende', () => {
  it('zuletzt eingesetzte oben, alle alphabetisch ohne Doppelte', () => {
    const o = personOptions(['Zora Test', 'Anna Beispiel', 'Ben Muster', 'Dora', 'Emil'], ['anna beispiel', 'Carla Probe'], '')
    expect(o.recent).toEqual(['Zora Test', 'Anna Beispiel', 'Ben Muster', 'Dora'])
    expect(o.all).toEqual(['Anna Beispiel', 'Ben Muster', 'Carla Probe', 'Dora', 'Emil', 'Zora Test'])
  })
  it('Suchfilter ohne Gross/Klein und Akzente', () => {
    const o = personOptions(['Zoé Test'], ['Carla Probe'], 'zoe')
    expect(o.recent).toEqual(['Zoé Test'])
    expect(o.all).toEqual(['Zoé Test'])
  })
})
