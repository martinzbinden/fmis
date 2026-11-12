import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '@fmis/core/historyApi'
import { buildSteps, describeStep, entryGroupId, planStepUndo, stepsOfGroup } from './groupHistory'

let n = 0
const entry = (table_name: string, row_id: string, action: HistoryEntry['action'], at: string, snapshot: Record<string, unknown>, by = 'a@x.ch'): HistoryEntry => ({
  id: `e${++n}`,
  table_name,
  row_id,
  action,
  changed_by: by,
  changed_at: at,
  snapshot: JSON.stringify(snapshot),
  updated_at: at,
})
const t = (s: string) => `2026-11-12T08:00:${s}Z`

describe('entryGroupId', () => {
  it('Gruppe, Mitglied und Stall gehören zur Gruppe, anderes nicht', () => {
    expect(entryGroupId(entry('herd_groups', 'g1', 'update', t('00'), {}))).toBe('g1')
    expect(entryGroupId(entry('herd_members', 'm1', 'insert', t('00'), { group_id: 'g2' }))).toBe('g2')
    expect(entryGroupId(entry('herd_stays', 's1', 'insert', t('00'), { group_id: 'g3' }))).toBe('g3')
    expect(entryGroupId(entry('locations', 'l1', 'update', t('00'), {}))).toBeNull()
  })
})

describe('buildSteps', () => {
  it('bündelt nach Person und Abstand, neueste zuerst', () => {
    const es = [
      entry('herd_members', 'm1', 'insert', t('00'), { group_id: 'g1' }),
      entry('herd_members', 'm2', 'insert', t('03'), { group_id: 'g1' }),
      entry('herd_members', 'm3', 'insert', t('40'), { group_id: 'g1' }),
      entry('herd_members', 'm4', 'insert', t('41'), { group_id: 'g1' }, 'b@x.ch'),
    ]
    const steps = buildSteps(es)
    expect(steps.map((s) => s.entries.length)).toEqual([1, 1, 2])
    expect(steps.map((s) => s.by)).toEqual(['b@x.ch', 'a@x.ch', 'a@x.ch'])
  })
  it('nimmt das Protokoll selbst nicht mit', () => {
    expect(buildSteps([entry('data_history', 'x', 'insert', t('00'), {})])).toEqual([])
  })
})

describe('describeStep', () => {
  const step = buildSteps([
    entry('herd_groups', 'g1', 'insert', t('00'), { active: true }),
    entry('herd_members', 'm1', 'insert', t('01'), { group_id: 'g1' }),
    entry('herd_members', 'm2', 'insert', t('01'), { group_id: 'g1' }),
    entry('herd_members', 'm3', 'update', t('02'), { group_id: 'g2', to_date: '2026-11-11' }),
    entry('herd_stays', 's1', 'insert', t('02'), { group_id: 'g1', slot: 'weide' }),
  ])[0]
  const names: Record<string, string> = { g1: 'Weide', g2: 'Stall' }

  it('fasst zusammen, was in dieser Gruppe passierte, und nennt die anderen', () => {
    const s = describeStep(step, 'g1', (id) => names[id])
    expect(s.title).toBe('Gruppe angelegt, 2 Tiere zugeteilt, Weide geändert')
    expect(s.others).toEqual(['Stall'])
    expect(s.rows).toBe(5)
  })
  it('aus Sicht der Herkunftsgruppe: Tiere entfernt', () => {
    expect(describeStep(step, 'g2', (id) => names[id]).title).toBe('1 Tier entfernt')
  })
  it('«Gruppe geändert» erscheint nur, wenn sonst nichts war', () => {
    const only = buildSteps([entry('herd_groups', 'g1', 'update', t('00'), { active: true })])[0]
    expect(describeStep(only, 'g1', (id) => id).title).toBe('Gruppe geändert')
    const withMembers = buildSteps([entry('herd_groups', 'g1', 'update', t('00'), { active: true }), entry('herd_members', 'm1', 'insert', t('01'), { group_id: 'g1' })])[0]
    expect(describeStep(withMembers, 'g1', (id) => id).title).toBe('1 Tier zugeteilt')
  })
  it('stepsOfGroup behält nur betroffene Schritte', () => {
    const other = buildSteps([entry('herd_members', 'm9', 'insert', t('59'), { group_id: 'g9' })])
    expect(stepsOfGroup([...other, ...[step]], 'g1')).toHaveLength(1)
  })
})

describe('planStepUndo', () => {
  it('ein doppelt geladener Eintrag ist nicht sein eigener Vorgänger', () => {
    const closing = entry('herd_members', 'm5', 'update', t('02'), { id: 'm5', group_id: 'g1', to_date: '2026-11-11' })
    const step = buildSteps([closing])[0]
    const plan = planStepUndo(step, [closing, closing])
    expect(plan.rows).toEqual([])
    expect(plan.missing).toEqual([{ table_name: 'herd_members', row_id: 'm5' }])
  })

  it('neue Zeile wird gelöscht, geänderte auf den Stand davor gesetzt', () => {
    const before = entry('herd_members', 'm3', 'insert', '2026-11-01T08:00:00Z', { id: 'm3', group_id: 'g2', to_date: null })
    const change = entry('herd_members', 'm3', 'update', t('02'), { id: 'm3', group_id: 'g2', to_date: '2026-11-11' })
    const added = entry('herd_members', 'm1', 'insert', t('01'), { id: 'm1', group_id: 'g1' })
    const step = buildSteps([added, change])[0]
    const plan = planStepUndo(step, [before, change, added])
    expect(plan.missing).toEqual([])
    const byRow = Object.fromEntries(plan.rows.map((r) => [r.row_id, r]))
    expect(byRow.m1.state).toBeNull()
    expect(byRow.m3.state).toMatchObject({ to_date: null })
  })

  it('zählt spätere Änderungen und meldet fehlenden früheren Stand', () => {
    const e1 = entry('herd_groups', 'g1', 'update', t('02'), { id: 'g1', active: false })
    const later = entry('herd_groups', 'g1', 'update', t('50'), { id: 'g1', active: true }, 'b@x.ch')
    const step = buildSteps([e1])[0]
    const plan = planStepUndo(step, [e1, later])
    expect(plan.rows).toEqual([])
    expect(plan.missing).toEqual([{ table_name: 'herd_groups', row_id: 'g1' }])
    const ins = entry('herd_groups', 'g2', 'insert', t('02'), { id: 'g2' })
    const laterG2 = entry('herd_groups', 'g2', 'update', t('55'), { id: 'g2', name: 'neu' })
    const p2 = planStepUndo(buildSteps([ins])[0], [ins, laterG2])
    expect(p2.rows[0]).toMatchObject({ state: null, later: 1 })
  })
})
