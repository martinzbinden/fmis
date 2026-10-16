import { describe, expect, it } from 'vitest'
import { formatSetting, keyFor, parseDefs, SUGGESTED_DEFS } from './machineSettings'

describe('Geräteeinstellungen', () => {
  it('liest Definitionen robust', () => {
    expect(parseDefs(null)).toEqual([])
    expect(parseDefs('kaputt')).toEqual([])
    expect(parseDefs('[{"key":"a","label":"A","unit":"cm"},{"x":1}]')).toEqual([{ key: 'a', label: 'A', unit: 'cm' }])
  })

  it('Saatkombination: Sämaschine und Kreiselegge in cm', () => {
    const defs = SUGGESTED_DEFS.saatkombination!
    expect(defs.map((d) => d.label)).toEqual(['Saatmengenschieber', 'Abstreifer', 'Höhe Planierblech', 'Schardruck'])
    expect(defs.every((d) => d.unit === 'cm')).toBe(true)
  })

  it('Schlüssel aus Bezeichnung, eindeutig', () => {
    expect(keyFor('Höhe Blech', 'Kreiselegge', new Set())).toBe('kreiselegge_hoehe_blech')
    expect(keyFor('Höhe Blech', undefined, new Set(['hoehe_blech']))).toBe('hoehe_blech_2')
  })

  it('formatiert gesetzte Werte in Definitionsreihenfolge', () => {
    const defs = SUGGESTED_DEFS.saatkombination!
    expect(formatSetting(defs, { schardruck: 4, saatmengenschieber: 3.5 })).toBe('Saatmengenschieber 3.5 cm · Schardruck 4 cm')
  })
})
