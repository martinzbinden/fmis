import { describe, expect, it } from 'vitest'
import { checkMaintenance, type MaintenanceValue } from './pasteMaintenance'

const machines = [
  { id: 'm1', name: 'John Deere 5100R' },
  { id: 'm2', name: 'John Deere 1950' },
  { id: 'm3', name: 'Hoflader Weidemann 1060 D/P' },
]
const log = [{ machine_id: 'm1', done_date: '2026-03-01', entry_type: 'wartung', title: 'Ölwechsel', counter: 2400 }]
const todos = [{ machine_id: 'm3', title: 'Schlauch ersetzen', status: 'offen' }]

describe('checkMaintenance', () => {
  const rows = checkMaintenance(
    [
      { maschine: 'John Deere 5100R', datum: '2026-03-01', art: 'wartung', titel: 'ölwechsel' }, // doppelt
      { maschine: 'John Deere 5100R', datum: '2026-03-01', art: 'wartung', titel: 'Filter' }, // ähnlich
      { maschine: 'John Deere', datum: '2026-03-02', titel: 'x' }, // mehrdeutig
      { maschine: 'Hoflader', datum: '2026-04-01', art: 'schaden', titel: 'Riss', pendenz: 'Schweissen', pendenz_bis: '2026-05-01', pendenz_prioritaet: 'hoch' },
      { maschine: 'Hoflader', datum: '2026-04-02', art: 'pendenz', titel: 'Schlauch ersetzen' }, // offene Pendenz besteht
      { maschine: '5100R', datum: '2026-04-05', art: 'zaehlerstand', zaehlerstand: 2300 }, // kleiner als vorher
      { maschine: 'Fendt', datum: '2026-04-05', titel: 'x', kosten_chf: -5 },
    ],
    machines,
    log,
    todos,
    '2026-10-08',
  )
  it('Status und Gründe', () => {
    expect(rows.map((r) => r.status)).toEqual(['doppelt', 'aehnlich', 'fehler', 'neu', 'doppelt', 'neu', 'fehler'])
    expect(rows[2].problems[0]).toMatch(/mehrere/)
    expect(rows[3].warnings[0]).toMatch(/zugeordnet zu «Hoflader/)
    expect(rows[5].warnings.join()).toMatch(/kleiner als 2400/)
    expect(rows[6].problems.join()).toMatch(/nicht gefunden.*Kosten negativ/)
  })
  it('Schaden mit Pendenz', () => {
    const v = rows[3].value as MaintenanceValue
    expect(v.machine_id).toBe('m3')
    expect(v.log?.entry_type).toBe('schaden')
    expect(v.todo).toEqual({ title: 'Schweissen', due_date: '2026-05-01', priority: 'hoch' })
  })
})
