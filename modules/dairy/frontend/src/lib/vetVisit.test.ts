import { describe, expect, it } from 'vitest'
import { pendingChecks } from './vetVisit'
import { DEFAULT_STALL_RULES } from './stallRules'

const TODAY = '2026-04-20'
const animals = [1, 2, 3, 4].map((n) => ({ id: `a${n}`, ear_tag: `CH${n}`, lauf_nr: String(n), name: null }))
const base = { animals, matings: [] as { animal_id: string; service_date: string; service_to: string | null }[], births: [] as { dam_id: string; birth_date: string }[], checks: [] as { animal_id: string; check_date: string; result: string }[] }
const rules = DEFAULT_STALL_RULES.sheep // ab Tag 35

describe('pendingChecks', () => {
  it('erst ab dem eingestellten Tag nach der Belegung', () => {
    const r = pendingChecks({ ...base, matings: [{ animal_id: 'a1', service_date: '2026-03-16', service_to: null }, { animal_id: 'a2', service_date: '2026-03-17', service_to: null }] }, rules, TODAY)
    // 35 Tage → a1 ja (35), a2 nein (34)
    expect(r.map((c) => c.animal.id)).toEqual(['a1'])
    expect(r[0].daysSince).toBe(35)
  })
  it('Zeitraum zählt ab Ende', () => {
    const m = [{ animal_id: 'a1', service_date: '2026-03-01', service_to: '2026-03-20' }]
    expect(pendingChecks({ ...base, matings: m }, rules, TODAY)).toEqual([])
  })
  it('mit Ergebnis ja oder leer nicht mehr offen, «unsicher» bleibt offen', () => {
    const m = ['a1', 'a2', 'a3'].map((id) => ({ animal_id: id, service_date: '2026-02-01', service_to: null }))
    const checks = [
      { animal_id: 'a1', check_date: '2026-03-20', result: 'ja' },
      { animal_id: 'a2', check_date: '2026-03-20', result: 'nein' },
      { animal_id: 'a3', check_date: '2026-03-20', result: 'unsicher' },
    ]
    const r = pendingChecks({ ...base, matings: m, checks }, rules, TODAY)
    expect(r.map((c) => c.animal.id)).toEqual(['a3'])
    expect(r[0].unsure).toBe(true)
  })
  it('Untersuchung vor der Belegung zählt nicht; Geburt seither schliesst aus', () => {
    const m = [{ animal_id: 'a1', service_date: '2026-02-01', service_to: null }, { animal_id: 'a2', service_date: '2026-02-01', service_to: null }]
    const r = pendingChecks({ ...base, matings: m, checks: [{ animal_id: 'a1', check_date: '2026-01-10', result: 'ja' }], births: [{ dam_id: 'a2', birth_date: '2026-03-01' }] }, rules, TODAY)
    expect(r.map((c) => c.animal.id)).toEqual(['a1'])
  })
  it('Überfälligstes zuerst, Regel 0 schaltet aus', () => {
    const m = [{ animal_id: 'a1', service_date: '2026-03-01', service_to: null }, { animal_id: 'a2', service_date: '2026-02-01', service_to: null }]
    expect(pendingChecks({ ...base, matings: m }, rules, TODAY).map((c) => c.animal.id)).toEqual(['a2', 'a1'])
    expect(pendingChecks({ ...base, matings: m }, { ...rules, kontrolleFromDays: 0 }, TODAY)).toEqual([])
  })
})
