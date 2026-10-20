import { describe, expect, it } from 'vitest'
import { computeHerdPerformance, cycleLtl, expectedByGroup, geoMean, indexScale, totalIndex, type PerformanceInput } from './herdPerformance'

describe('expectedByGroup', () => {
  it('interpoliert kleine Gruppen zwischen zwei sicheren Nachbarn', () => {
    const values = [
      ...Array.from({ length: 5 }, () => ({ group: 1, value: 0.2 })),
      { group: 2, value: 9 }, // nur ein Tier — zu unsicher
      ...Array.from({ length: 5 }, () => ({ group: 3, value: 0.6 })),
    ]
    const e = expectedByGroup(values)
    expect(e.get(1)).toBeCloseTo(0.2)
    expect(e.get(2)).toBeCloseTo(0.4)
    expect(e.get(3)).toBeCloseTo(0.6)
  })

  it('übernimmt am Rand den nächsten sicheren Wert', () => {
    const values = [...Array.from({ length: 5 }, () => ({ group: 2, value: 0.5 })), { group: 7, value: 3 }]
    expect(expectedByGroup(values).get(7)).toBeCloseTo(0.5)
  })

  it('nimmt den Rohwert, wenn keine Gruppe sicher ist', () => {
    expect(expectedByGroup([{ group: 1, value: 0.3 }, { group: 1, value: 0.5 }]).get(1)).toBeCloseTo(0.4)
  })
})

describe('indexScale', () => {
  it('skaliert auf Mittel 100 / Streuung 10', () => {
    const idx = indexScale(new Map([['a', 1], ['b', 3], ['c', null]]))
    expect(idx.get('a')).toBe(90)
    expect(idx.get('b')).toBe(110)
    expect(idx.get('c')).toBeNull()
  })

  it('dreht bei der Zellzahl das Vorzeichen (tief = gut)', () => {
    const idx = indexScale(new Map([['tief', 100], ['hoch', 400]]), { invert: true, log: true })
    expect(idx.get('tief')).toBe(110)
    expect(idx.get('hoch')).toBe(90)
  })

  it('braucht mindestens zwei Werte', () => {
    expect(indexScale(new Map([['a', 1]])).get('a')).toBeNull()
  })
})

describe('totalIndex', () => {
  it('setzt fehlende Teilwerte auf das Herdenmittel 100', () => {
    expect(totalIndex(110, null)).toBe(106)
    expect(totalIndex(null, 80)).toBe(92)
    expect(totalIndex(null, null)).toBeNull()
  })
})

describe('geoMean', () => {
  it('ignoriert fehlende und Null-Werte', () => {
    expect(geoMean([100, 400, null, 0])).toBeCloseTo(200)
  })
})


describe('stadienunabhängige Lebenstagleistung', () => {
  it('cycleLtl: Milch abgeschlossener Laktationen / Lebenstage bis zur laufenden Abkalbung', () => {
    // 2022-01-01 bis 2025-09-01 = 1339 Tage
    expect(cycleLtl('2022-01-01', '2025-09-01', 16000, 2)).toBeCloseTo(11.949, 3)
    expect(cycleLtl(null, '2025-09-01', 16000, 2)).toBeNull()
    expect(cycleLtl('2022-01-01', null, 16000, 2)).toBeNull()
    expect(cycleLtl('2022-01-01', '2025-09-01', 16000, 0)).toBeNull()
  })

  /** Sechs Kühe: zwei abgeschlossene Laktationen und eine laufende, die am Stichtag `runningMilk` kg hat. */
  const herd = (runningMilk: number): PerformanceInput[] =>
    [16000, 16000, 16000, 16000, 16000, 12800].map((done, i) => ({
      id: `k${i}`,
      birth_date: '2022-01-01',
      tests: [],
      lactations: [
        { lactation_number: 1, closure_type: 2, milk_kg: done / 2, fat_kg: null, protein_kg: null, days_in_milk: 305, calving_date: '2023-09-01' },
        { lactation_number: 2, closure_type: 2, milk_kg: done / 2, fat_kg: null, protein_kg: null, days_in_milk: 305, calving_date: '2024-09-01' },
        { lactation_number: 3, closure_type: 8, milk_kg: runningMilk, fat_kg: null, protein_kg: null, days_in_milk: null, calving_date: '2025-09-01' },
      ],
    }))

  it('ändert sich nicht mit dem Laktationstag, die klassische Lebenstagleistung schon', () => {
    // Tag 30 der laufenden Laktation vs. Tag 300 — dieselben Kühe
    const early = computeHerdPerformance(herd(750), '2025-10-01')
    const late = computeHerdPerformance(herd(7500), '2026-06-28')
    for (const id of ['k0', 'k5']) {
      expect(early.get(id)!.ltl_cycle_rel).toBe(late.get(id)!.ltl_cycle_rel)
      expect(early.get(id)!.performance_rel_stage).toBe(late.get(id)!.performance_rel_stage)
    }
    // Gruppenmittel (5×16000 + 12800)/6 = 15467 kg: k0 = 16000/15467, k5 = 12800/15467
    expect(early.get('k0')!.ltl_cycle_rel).toBeCloseTo(1.034, 3)
    expect(early.get('k5')!.ltl_cycle_rel).toBeCloseTo(0.828, 3)
    expect(early.get('k5')!.performance_basis_stage).toBe('Lebenstagleistung bis zur Abkalbung')
    // klassisch: frisch abgekalbt deutlich tiefer als am Laktationsende (Gruppenvergleich bleibt aber gleich,
    // darum zeigt sich der Stadium-Effekt beim absoluten Wert)
    expect(early.get('k0')!.ltl_milk!).toBeLessThan(late.get('k0')!.ltl_milk!)
    expect(late.get('k0')!.ltl_milk! / early.get('k0')!.ltl_milk!).toBeGreaterThan(1.15)
  })

  it('ohne laufende Laktation gilt der klassische Wert', () => {
    const dry = herd(0).map((a) => ({ ...a, lactations: a.lactations.slice(0, 2) }))
    const m = computeHerdPerformance(dry, '2025-10-01').get('k0')!
    expect(m.ltl_cycle_rel).toBeNull()
    expect(m.performance_rel_stage).toBe(m.performance_rel)
    expect(m.performance_basis_stage).toBe(m.performance_basis)
  })
})
