import { describe, expect, it } from 'vitest'
import { formatSetting, keyFor, kgPerHaFromSample, parseDefs, rateDef, suggestSlide, SUGGESTED_DEFS } from './machineSettings'

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

describe('Vorschlag Saatmengenschieber', () => {
  const at = '2026-10-01T08:00:00Z'
  const s = (crop: string, slide: number, kgHa: number) => ({
    id: `${crop}-${slide}`,
    machine_id: 'm',
    track_id: null,
    set_at: at,
    settings: { saatmengenschieber: slide },
    crop,
    measured_kg_ha: kgHa,
    notes: null,
    created_by: null,
  })

  it('erkennt die Einstellgrösse für die Saatmenge', () => {
    expect(rateDef(SUGGESTED_DEFS.saatkombination!)?.key).toBe('saatmengenschieber')
    expect(rateDef([{ key: 'x', label: 'Abstreifer', unit: 'cm' }])).toBeNull()
  })

  it('eine Probe: proportional', () => {
    const r = suggestSlide([s('Winterweizen Wiwa', 3, 150)], 'saatmengenschieber', 'winterweizen  wiwa', 180)
    expect(r).toMatchObject({ value: 3.6, basis: 'sorte', method: 'proportional', extrapolated: true })
  })

  it('mehrere Proben: Gerade, gleiche Sorte vor gleicher Kultur', () => {
    const log = [s('Winterweizen Wiwa', 3, 140), s('Winterweizen Wiwa', 4, 200), s('Winterweizen Montalbano', 5, 400)]
    const r = suggestSlide(log, 'saatmengenschieber', 'Winterweizen Wiwa', 170)
    expect(r).toMatchObject({ value: 3.5, basis: 'sorte', method: 'linear', extrapolated: false })
    const k = suggestSlide(log, 'saatmengenschieber', 'Winterweizen Bodensee', 170)
    expect(k?.basis).toBe('kultur')
    expect(k?.points).toHaveLength(3)
  })

  it('ohne passende Probe kein Vorschlag', () => {
    expect(suggestSlide([s('Gerste', 3, 150)], 'saatmengenschieber', 'Weizen', 180)).toBeNull()
    expect(suggestSlide([], 'saatmengenschieber', 'Weizen', 180)).toBeNull()
  })

  it('Abdrehprobe: Gramm auf m² → kg/ha', () => {
    expect(kgPerHaFromSample(450, 25)).toBe(180)
    expect(kgPerHaFromSample(0, 25)).toBeNull()
  })
})
