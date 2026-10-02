import { describe, expect, it } from 'vitest'
import { Inbreeding, inbreedingClass, type PedigreeLink } from './inbreeding'

function ped(entries: Record<string, [string | null, string | null]>): Inbreeding {
  return new Inbreeding(new Map<string, PedigreeLink>(Object.entries(entries).map(([k, [sire, dam]]) => [k, { sire, dam }])))
}

describe('Inbreeding', () => {
  // S, D Gründer; A, B Vollgeschwister; H Halbgeschwister von A (Vater S, Mutter E)
  const p = ped({
    A: ['S', 'D'],
    B: ['S', 'D'],
    H: ['S', 'E'],
    VS: ['A', 'B'], // Vollgeschwister-Paarung
    HS: ['A', 'H'], // Halbgeschwister-Paarung
    PO: ['S', 'A'], // Vater × Tochter
    GG: ['S', 'VS'], // Grossvater × Enkelin aus Vollgeschwister-Paarung
    CA: ['A', 'X'],
    CB: ['B', 'Y'],
    CO: ['CA', 'CB'], // Cousins (Kinder von Vollgeschwistern)
  })

  it('Gründer und Unverwandte haben F = 0', () => {
    expect(p.inbreeding('A')).toBe(0)
    expect(p.kinship('S', 'D')).toBe(0)
    expect(p.inbreeding('unbekannt')).toBe(0)
  })

  it('Vollgeschwister-Paarung F = 0.25', () => {
    expect(p.inbreeding('VS')).toBeCloseTo(0.25)
  })

  it('Halbgeschwister-Paarung F = 0.125', () => {
    expect(p.inbreeding('HS')).toBeCloseTo(0.125)
  })

  it('Vater × Tochter F = 0.25', () => {
    expect(p.inbreeding('PO')).toBeCloseTo(0.25)
  })

  it('Cousin-Paarung F = 0.0625', () => {
    expect(p.inbreeding('CO')).toBeCloseTo(0.0625)
  })

  it('berücksichtigt Inzucht der Vorfahren', () => {
    // f(S, VS) = ½ (f(S, A) + f(S, B)) = ½ (¼ + ¼) = ¼ → F(GG) = 0.25
    expect(p.inbreeding('GG')).toBeCloseTo(0.25)
    // Selbstverwandtschaft eines ingezüchteten Tiers: (1 + F) / 2
    expect(p.kinship('VS', 'VS')).toBeCloseTo(0.625)
  })

  it('erwartete Inzucht einer geplanten Anpaarung', () => {
    expect(p.offspring('B', 'A')).toBeCloseTo(0.25)
    expect(p.offspring('D', 'X')).toBe(0)
  })

  it('misst die Stammbaumtiefe in äquivalenten vollständigen Generationen', () => {
    expect(p.completeness('S')).toBe(0)
    expect(p.completeness('A')).toBe(1)
    expect(p.completeness('VS')).toBe(2)
    expect(p.completeness('CA')).toBe(1.5) // X ohne Eltern
  })

  it('übersteht einen fehlerhaften Zyklus im Stammbaum', () => {
    const cyc = ped({ A: ['B', null], B: ['A', null] })
    expect(Number.isFinite(cyc.inbreeding('A'))).toBe(true)
    expect(Number.isFinite(cyc.completeness('A'))).toBe(true)
  })
})

describe('inbreedingClass', () => {
  it('stuft ein', () => {
    expect(inbreedingClass(0)).toBe('none')
    expect(inbreedingClass(0.01)).toBe('low')
    expect(inbreedingClass(0.04)).toBe('medium')
    expect(inbreedingClass(0.0625)).toBe('high')
  })
})
