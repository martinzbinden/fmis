import { describe, expect, it } from 'vitest'
import { hasOlderJournal, splitOverdue } from './workPlanView'

describe('Arbeitsplan: überfällige Planungen', () => {
  it('älter als 14 Tage → eigener Block, der Rest bleibt', () => {
    const tasks = [{ date: '2026-03-01' }, { date: '2026-03-16' }, { date: '2026-03-17' }, { date: '2026-04-02' }]
    const { current, overdue } = splitOverdue(tasks, '2026-03-31')
    expect(overdue.map((t) => t.date)).toEqual(['2026-03-01', '2026-03-16'])
    expect(current.map((t) => t.date)).toEqual(['2026-03-17', '2026-04-02'])
  })
  it('ältere Journal-Einträge vorhanden?', () => {
    expect(hasOlderJournal(null, '2026-01-01')).toBe(false)
    expect(hasOlderJournal('2025-05-01', '2026-01-01')).toBe(true)
    expect(hasOlderJournal('2026-01-01', '2026-01-01')).toBe(false)
  })
})
