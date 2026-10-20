import { describe, expect, it } from 'vitest'
import { cullingReasons, DEFAULT_THRESHOLDS, reasonScore, type CullingInput } from './culling'
import { computeFertility } from './fertility'

function cow(overrides: Partial<CullingInput> = {}): CullingInput {
  return {
    species: 'cattle',
    fertility: computeFertility([], [], 'cattle', '2025-07-01'),
    performance: undefined,
    currentLactationScc: [],
    breedingValues: {},
    lactationNumber: 2,
    recentOffspring: [],
    ...overrides,
  }
}

describe('cullingReasons', () => {
  it('meldet nichts bei einer unauffälligen Kuh', () => {
    expect(cullingReasons(cow(), DEFAULT_THRESHOLDS.cattle)).toEqual([])
  })

  it('erkennt lange ZKZ und viele Besamungen', () => {
    const fertility = computeFertility(
      [
        { birth_date: '2023-01-01', parity: 1, conception_date: null },
        { birth_date: '2024-03-01', parity: 2, conception_date: null },
      ],
      ['2023-03-01', '2023-04-01', '2023-05-01', '2023-05-25'].map((service_date) => ({
        service_date, service_to: null, kind: 'kb' as const, sire_key: null, sire_name: null,
      })),
      'cattle',
      '2024-05-01',
    )
    const reasons = cullingReasons(cow({ fertility }), DEFAULT_THRESHOLDS.cattle)
    expect(reasons.map((r) => r.text)).toEqual(['ZKZ 425 Tage (Grenze 420)', '4 Belegungen bis zur letzten Trächtigkeit'])
    expect(reasonScore(reasons)).toBe(4)
  })

  it('zählt hohe Zellzahlproben der laufenden Laktation', () => {
    const reasons = cullingReasons(cow({ currentLactationScc: [150, 250, 300, null, 410, 90] }), DEFAULT_THRESHOLDS.cattle)
    expect(reasons).toEqual([{ area: 'euter', weight: 2, text: "3 von 5 Proben dieser Laktation über 200'000 Zellen" }])
  })

  describe('Zellzahl nach Laktationsstadium', () => {
    const T = DEFAULT_THRESHOLDS.cattle
    const tests = (xs: [number, number | null][]) => xs.map(([scc, dim]) => ({ scc, dim }))
    const euter = (xs: [number, number | null][], t = T) => cullingReasons(cow({ currentLactationTests: tests(xs) }), t).filter((r) => r.area === 'euter')

    it('die ersten Tage nach der Geburt zählen nicht (Kolostrum/Frischmelker)', () => {
      const r = euter([[900, 3], [800, 5], [250, 60], [260, 100], [270, 120]])
      expect(r).toEqual([
        { area: 'euter', weight: 2, text: "3 von 3 Proben dieser Laktation über 200'000 Zellen (2 Proben in den ersten 10 Tagen nicht gezählt)" },
      ])
      // ohne Stadium-Regel zählten die zwei frühen Proben mit
      expect(euter([[900, 3], [800, 5], [250, 60]], { ...T, sccIgnoreDays: 0 })[0].text).toContain('3 von 3')
      expect(euter([[900, 3], [800, 5], [250, 60]])).toEqual([])
    })

    it('ab dem Spätlaktations-Tag gilt die höhere Grenze', () => {
      // 250/280/290 liegen über 200, aber unter 300 (= 200 × 1.5)
      expect(euter([[250, 260], [280, 270], [290, 300]])).toEqual([])
      const r = euter([[320, 260], [350, 270], [400, 300]])
      expect(r[0].text).toBe("3 von 3 Proben dieser Laktation über 200'000 Zellen (ab Tag 250 300'000)")
      // dieselben Werte vor Tag 250 zählen nach der normalen Grenze
      expect(euter([[250, 100], [280, 110], [290, 120]])[0].text).toContain('3 von 3')
    })

    it('Stadium-Regeln lassen sich abschalten; ohne Laktationstag gilt die einfache Zählung', () => {
      const off = { ...T, sccIgnoreDays: 0, sccLateDay: 0 }
      expect(euter([[900, 3], [800, 5], [250, 280]], off)[0].text).toBe("3 von 3 Proben dieser Laktation über 200'000 Zellen")
      expect(euter([[250, null], [300, null], [410, null]])[0].text).toBe("3 von 3 Proben dieser Laktation über 200'000 Zellen")
    })
  })

  it('Leistung: bevorzugt den stadienunabhängigen Wert und nennt die Grundlage', () => {
    const base = {
      id: 'x', lifetime_days: 1500, n_lactations: 2, n_running: 1, lactation_group: 3, milk_total: 0, fat_protein_total: 0,
      ltl_milk: null, ltl_fe: null, standard_milk: null, ltl_milk_expected: null, ltl_milk_rel: null, ltl_fe_rel: null,
      performance_rel: 0.7, performance_basis: 'Lebenstagleistung' as const, ltl_cycle_milk: null, ltl_cycle_rel: null,
      scc_geo: null, scc_geo_12m: null, scc_max: null, n_tests: 5, data_basis: 'gut' as const, idx_performance: null, idx_scc: null, idx_scc_12m: null,
    }
    // klassisch 70 % (frisch abgekalbt, wirkt schlecht), stadienunabhängig 95 % → kein Hinweis
    expect(cullingReasons(cow({ performance: { ...base, performance_rel_stage: 0.95, performance_basis_stage: 'Lebenstagleistung bis zur Abkalbung' } }), DEFAULT_THRESHOLDS.cattle)).toEqual([])
    const r = cullingReasons(cow({ performance: { ...base, performance_rel_stage: 0.78, performance_basis_stage: 'Lebenstagleistung bis zur Abkalbung' } }), DEFAULT_THRESHOLDS.cattle)
    expect(r).toEqual([{ area: 'leistung', weight: 1, text: 'Lebenstagleistung (bis zur letzten Abkalbung) 22 % unter Gleichaltrigen' }])
  })

  it('meldet bei Schafen Lammverluste', () => {
    const reasons = cullingReasons(
      cow({
        species: 'sheep',
        recentOffspring: [
          { stillborn: true, died_24h: false },
          { stillborn: false, died_24h: true },
          { stillborn: false, died_24h: false },
        ],
      }),
      DEFAULT_THRESHOLDS.sheep,
    )
    expect(reasons.map((r) => r.text)).toEqual(['2 von 3 Nachkommen tot (letzte zwei Geburten)'])
  })
})
