import { describe, expect, it } from 'vitest'
import { costsByYear, journalCount } from './machineJournal'

describe('Wartungsjournal mit gelöschten Maschinen', () => {
  const machines = new Map([
    ['a', { owner: null, deleted_at: null }],
    ['b', { owner: 'Lohnunternehmen Muster', deleted_at: null }],
    ['c', { owner: null, deleted_at: '2026-05-01T00:00:00Z' }],
  ])
  const log = [
    { machine_id: 'a', done_date: '2026-03-01', cost_chf: 100 },
    { machine_id: 'c', done_date: '2026-04-01', cost_chf: 50 },
    { machine_id: 'b', done_date: '2025-06-01', cost_chf: 20 },
    { machine_id: 'a', done_date: '2025-07-01', cost_chf: null },
  ]
  it('Kosten je Jahr zählen gelöschte Maschinen mit und weisen sie aus', () => {
    const y = costsByYear(log, machines)
    expect(y.map((x) => x.year)).toEqual(['2026', '2025'])
    expect(y[0].owners.get('eigene')).toBe(150)
    expect(y[0].deleted).toBe(50)
    expect(y[1].owners.get('Lohnunternehmen Muster')).toBe(20)
    expect(y[1].deleted).toBe(0)
  })
  it('Einträge je Maschine', () => {
    expect(journalCount(log, 'a')).toBe(2)
    expect(journalCount(log, 'x')).toBe(0)
  })
})
