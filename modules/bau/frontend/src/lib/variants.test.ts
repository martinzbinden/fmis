import { describe, expect, it } from 'vitest'
import { compareVariants, defaultView, inView, nextVariantName } from './variants'
import type { BauFeature, Variant } from '../types'

const v = (id: string, name: string): Variant => ({ id, project_id: 'p', name, notes: null, sort_order: 0, created_by: null, updated_at: '', deleted_at: null })
const line = (id: string, variant_id: string | null, category: BauFeature['category'], coords: [number, number][], status: BauFeature['status'] = 'geplant'): BauFeature => ({
  id, project_id: 'p', category, status, label: null, geometry: JSON.stringify({ type: 'LineString', coordinates: coords }), plan_geometry: null,
  material: null, diameter_mm: null, depth_cm: null, notes: null, sort_order: 0, created_by: null, updated_at: '', deleted_at: null, variant_id,
})

describe('Varianten', () => {
  it('zeigt gemeinsame Objekte in jeder Variante', () => {
    expect(inView({ variant_id: null }, 'a')).toBe(true)
    expect(inView({ variant_id: 'a' }, 'a')).toBe(true)
    expect(inView({ variant_id: 'b' }, 'a')).toBe(false)
    expect(inView({ variant_id: 'b' }, 'alle')).toBe(true)
  })
  it('öffnet die gewählte Variante, sonst alles', () => {
    expect(defaultView({ chosen_variant_id: 'b' }, [v('a', 'A'), v('b', 'B')])).toBe('b')
    expect(defaultView({ chosen_variant_id: 'x' }, [v('a', 'A')])).toBe('alle')
    expect(defaultView({ chosen_variant_id: null }, [])).toBe('alle')
  })
  it('vergibt den nächsten freien Buchstaben', () => {
    expect(nextVariantName([])).toBe('A')
    expect(nextVariantName([{ name: 'A: Strasse' }, { name: 'C' }])).toBe('B')
  })
  it('vergleicht Längen je Kategorie inkl. gemeinsamer Leitungen, ohne verworfene', () => {
    // 0.001° Breite ≈ 111 m
    const f = [
      line('1', null, 'leerrohr', [[7.4, 46.78], [7.4, 46.781]]),
      line('2', 'a', 'guelle', [[7.4, 46.78], [7.4, 46.781]]),
      line('3', 'b', 'guelle', [[7.4, 46.78], [7.4, 46.782]]),
      line('4', 'b', 'guelle', [[7.4, 46.78], [7.4, 46.79]], 'verworfen'),
    ]
    const { rows, categories } = compareVariants(f, [v('a', 'A'), v('b', 'B')])
    expect(categories).toEqual(['guelle', 'leerrohr'].filter((c) => categories.includes(c as never)))
    expect(Math.round(rows[0].lengths.guelle!)).toBe(111)
    expect(Math.round(rows[1].lengths.guelle!)).toBe(222)
    expect(Math.round(rows[1].lengths.leerrohr!)).toBe(111)
    expect(rows[1].own).toBe(1)
  })
})
