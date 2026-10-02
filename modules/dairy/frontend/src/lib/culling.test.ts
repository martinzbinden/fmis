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
