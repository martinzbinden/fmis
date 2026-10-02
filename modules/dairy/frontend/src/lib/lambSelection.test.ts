import { describe, expect, it } from 'vitest'
import { DEFAULT_SELECTION_SETTINGS, lambIndex, rankLambs, type DamInfo, type LambCandidate } from './lambSelection'
import type { PerformanceMetrics } from './herdPerformance'

const perf = (idx_performance: number | null, idx_scc: number | null, idx_scc_12m: number | null = idx_scc) =>
  ({ idx_performance, idx_scc, idx_scc_12m }) as PerformanceMetrics

const dam = (key: string, p: PerformanceMetrics | undefined): [string, DamInfo] => [
  key,
  { id: `id-${key}`, ear_tag: key, name: null, lauf_nr: null, performance: p },
]

const lamb = (key: string, extra: Partial<LambCandidate> = {}): LambCandidate => ({
  key,
  ear_tag: key,
  name: null,
  animal_id: null,
  birth_date: '2026-03-01',
  sex: 'w',
  dam_key: 'D1',
  sire_key: 'S1',
  litter_size: 2,
  birth_weight_kg: null,
  ...extra,
})

describe('lambIndex', () => {
  it('entspricht gesamtindex() des Originals ohne Vater', () => {
    // 0.6 · 112 + 0.4 · 95 = 105.2
    expect(lambIndex(112, 95, 130, DEFAULT_SELECTION_SETTINGS)).toBe(105.2)
  })

  it('setzt fehlende Teilwerte auf 100', () => {
    expect(lambIndex(null, 90, null, DEFAULT_SELECTION_SETTINGS)).toBe(96)
    expect(lambIndex(null, null, 120, DEFAULT_SELECTION_SETTINGS)).toBeNull()
  })

  it('normiert die Gewichte, wenn der Vater dazukommt', () => {
    // (0.6·110 + 0.4·100 + 0.5·120) / 1.5 = 110.7
    expect(lambIndex(110, 100, 120, { weightPerformance: 0.6, weightScc: 0.4, weightSire: 0.5 })).toBe(110.7)
  })
})

describe('rankLambs', () => {
  const base = {
    dams: new Map([dam('D1', perf(110, 100)), dam('D2', perf(90, 120)), dam('D3', undefined)]),
    sireValues: new Map([['S1', 120]]),
    inbreeding: (d: string | null, s: string | null) => (d === 'D2' && s === 'S1' ? 0.125 : 0),
    decisions: new Map([['L2', 'mast' as const]]),
    settings: DEFAULT_SELECTION_SETTINGS,
    today: '2026-09-01',
  }

  it('rangiert weibliche Jungtiere nach dem Index der Mutter', () => {
    const rows = rankLambs({
      ...base,
      candidates: [
        lamb('L1', { dam_key: 'D2' }),
        lamb('L2'),
        lamb('L3', { sex: 'm' }),
        lamb('L4', { dam_key: 'D3' }),
        lamb('L5', { dam_key: null }),
      ],
    })
    expect(rows.map((r) => r.key)).toEqual(['L2', 'L3', 'L1', 'L4', 'L5'])
    expect(rows.map((r) => r.rank)).toEqual([1, null, 2, null, null])
    expect(rows[0].index).toBe(106)
    expect(rows[0].purpose).toBe('mast')
    expect(rows[2].inbreeding).toBe(0.125)
    expect(rows[0].dam_daughters).toBe(1)
    expect(rows[0].sire_value).toBe(120)
  })

  it('filtert nach Alter', () => {
    const rows = rankLambs({
      ...base,
      candidates: [lamb('alt', { birth_date: '2025-12-01' }), lamb('jung', { birth_date: '2026-08-01' }), lamb('ungeboren', { birth_date: '2026-10-01' })],
    })
    expect(rows.map((r) => r.key)).toEqual(['jung'])
    expect(rows[0].age_days).toBe(31)
  })

  it('nimmt wahlweise die Zellzahl der letzten 12 Monate', () => {
    const rows = rankLambs({
      ...base,
      dams: new Map([dam('D1', perf(100, 100, 80))]),
      candidates: [lamb('L1')],
      settings: { ...DEFAULT_SELECTION_SETTINGS, scc12m: true },
    })
    expect(rows[0].idx_scc).toBe(80)
    expect(rows[0].index).toBe(92)
  })
})
