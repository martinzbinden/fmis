import { describe, expect, it } from 'vitest'
import { categoryOf, counterUnit, intervalText, latestCounter, taskStatus, tasksFromTemplate, trackedHoursSince, TEMPLATES } from './maintenance'
import type { MaintenanceLog, MaintenanceTask } from '../types'

const base = { updated_at: '', deleted_at: null }
const task = (id: string, count: number | null, months: number | null): MaintenanceTask => ({
  id,
  machine_id: 'm',
  title: id,
  task_type: 'oel',
  interval_count: count,
  interval_months: months,
  notes: null,
  active: true,
  sort_order: 0,
  template_key: null,
  ...base,
})
const entry = (date: string, counter: number | null, taskIds: string[] = [], id = date): MaintenanceLog => ({
  id,
  machine_id: 'm',
  done_date: date,
  entry_type: taskIds.length ? 'wartung' : 'zaehlerstand',
  title: null,
  task_ids: taskIds.length ? JSON.stringify(taskIds) : null,
  counter,
  cost_chf: null,
  material: null,
  done_by: null,
  notes: null,
  ...base,
})
const tractor = { kind: 'traktor' as const, category: null }

describe('maintenance', () => {
  it('Kategorie nach Art, übersteuerbar; Autos in km', () => {
    expect(categoryOf({ kind: 'hoflader', category: null })).toBe('zugfahrzeug')
    expect(categoryOf({ kind: 'ladewagen', category: null })).toBe('anhaenger')
    expect(categoryOf({ kind: 'ladergeraet', category: null })).toBe('anbaugeraet')
    expect(categoryOf({ kind: 'andere', category: 'auto' })).toBe('auto')
    expect(counterUnit({ kind: 'auto', category: null })).toBe('km')
  })

  it('Ölwechsel nach Stundenzähler: fällig, bald, ok', () => {
    const t = task('oel', 500, 12)
    const log = [entry('2026-01-10', 1200, ['oel']), entry('2026-09-01', 1650)]
    const s = taskStatus(t, { machine: tractor, log, tracks: [], today: '2026-10-01' })
    expect(s).toMatchObject({ countUsed: 450, countLeft: 50, state: 'bald' })
    expect(s.dueDate).toBe('2027-01-10')
    const over = taskStatus(t, { machine: tractor, log: [...log, entry('2026-09-20', 1710)], tracks: [], today: '2026-10-01' })
    expect(over.state).toBe('faellig')
    const ok = taskStatus(t, { machine: tractor, log: [entry('2026-09-01', 1600, ['oel'])], tracks: [], today: '2026-10-01' })
    expect(ok.state).toBe('ok')
  })

  it('Monatsintervall überfällig, nie erledigt = offen', () => {
    const t = task('bremsen', null, 12)
    expect(taskStatus(t, { machine: tractor, log: [entry('2025-09-01', null, ['bremsen'])], tracks: [], today: '2026-10-01' }).state).toBe('faellig')
    expect(taskStatus(t, { machine: tractor, log: [], tracks: [], today: '2026-10-01' }).state).toBe('offen')
  })

  it('Gerät ohne Zähler: Stunden aus GPS-Fahrten seit der Erledigung', () => {
    const tracks = [
      { started_at: '2026-08-01T08:00:00Z', ended_at: '2026-08-01T12:00:00Z' },
      { started_at: '2026-09-05T08:00:00Z', ended_at: '2026-09-05T14:00:00Z' },
      { started_at: '2026-09-06T08:00:00Z', ended_at: null },
    ]
    expect(trackedHoursSince(tracks, '2026-09-01')).toBe(6)
    const s = taskStatus(task('messer', 20, null), { machine: { kind: 'ladewagen', category: null }, log: [entry('2026-09-01', null, ['messer'])], tracks, today: '2026-10-01' })
    expect(s).toMatchObject({ countUsed: 6, countLeft: 14, state: 'ok' })
  })

  it('Zählerstand: neuester nach Datum', () => {
    expect(latestCounter([entry('2026-01-01', 900), entry('2026-05-01', 1100), entry('2026-03-01', 1000)])).toEqual({ value: 1100, date: '2026-05-01' })
  })

  it('Vorlage: nur fehlende Aufgaben, Text der Intervalle', () => {
    let n = 0
    const first = tasksFromTemplate({ id: 'm', kind: 'traktor' }, [], () => `t${++n}`)
    expect(first.length).toBe(TEMPLATES.traktor.length)
    expect(tasksFromTemplate({ id: 'm', kind: 'traktor' }, first, () => 'x')).toHaveLength(0)
    expect(intervalText(first[0], 'h')).toBe('alle 500 h oder jährlich')
    expect(intervalText({ interval_count: 15000, interval_months: null }, 'km')).toBe("alle 15’000 km")
  })
})
