import { describe, expect, it } from 'vitest'
import { compareRank, farmPct, targetMinutes, workloadRank } from './workload'

describe('Pensum', () => {
  it('Anstellung minus Schule, ohne Anstellung null', () => {
    expect(farmPct({ employment_pct: 60, school_pct: 20 })).toBe(40)
    expect(farmPct({ employment_pct: 50, school_pct: null })).toBe(50)
    expect(farmPct({ employment_pct: null, school_pct: null })).toBeNull()
    expect(targetMinutes({ employment_pct: 60, school_pct: 20 }, 50)).toBe(1200)
  })

  it('unter Soll zuerst, dann ohne Anstellung, dann über Soll', () => {
    const under = workloadRank(600, 1200)
    const family = workloadRank(3000, null)
    const over = workloadRank(1600, 1500)
    const lower = workloadRank(300, 1200)
    expect([over, family, under, lower].sort(compareRank)).toEqual([lower, under, family, over])
  })
})
