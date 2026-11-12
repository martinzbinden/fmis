import { describe, expect, it } from 'vitest'
import {
  applyFilters,
  conditionComplete,
  countMatches,
  describeCondition,
  describeFilter,
  matchesCondition,
  matchesFilter,
  retargetCondition,
  type FieldDef,
  type FilterDef,
} from './filterModel'

interface Row {
  nr: string
  age: number | null
  birth: string | null
  groups: string[]
  pregnant: boolean
  sex: string | null
}

const fields: FieldDef<Row>[] = [
  { key: 'nr', label: 'Nummer', type: 'text', get: (r) => r.nr },
  { key: 'age', label: 'Alter', type: 'number', unit: 'Monate', get: (r) => r.age },
  { key: 'birth', label: 'Geburt', type: 'date', get: (r) => r.birth },
  { key: 'list', label: 'Merkliste', type: 'choice', options: [{ value: 'a', label: 'Ausmerzen' }, { value: 'b', label: 'Beobachten' }], get: (r) => r.groups },
  { key: 'preg', label: 'Trächtig', type: 'bool', get: (r) => r.pregnant },
  { key: 'sex', label: 'Geschlecht', type: 'choice', options: [{ value: 'w', label: 'weiblich' }, { value: 'm', label: 'männlich' }], get: (r) => r.sex },
]

const ctx = { today: '2026-11-10' }
const row = (p: Partial<Row> = {}): Row => ({ nr: '2212', age: 80, birth: '2020-03-01', groups: [], pregnant: false, sex: 'w', ...p })
const filter = (match: 'all' | 'any', ...conditions: FilterDef['conditions']): FilterDef => ({ id: 'f', name: 'Test', color: 'rot', match, conditions })

describe('matchesCondition', () => {
  it('Text: enthält ohne Grossschreibung, leer trifft nie', () => {
    expect(matchesCondition('Ab-2212', 'text', { field: 'nr', op: 'contains', value: 'ab-22' }, ctx)).toBe(true)
    expect(matchesCondition('2212', 'text', { field: 'nr', op: 'contains', value: '' }, ctx)).toBe(false)
    expect(matchesCondition('2212', 'text', { field: 'nr', op: 'not_contains', value: '99' }, ctx)).toBe(true)
  })

  it('Zahl: Vergleiche, zwischen und Komma', () => {
    const t = (op: 'gt' | 'le' | 'eq' | 'between', v: string, v2?: string) => matchesCondition(72, 'number', { field: 'age', op, value: v, value2: v2 }, ctx)
    expect(t('gt', '60')).toBe(true)
    expect(t('gt', '72')).toBe(false)
    expect(t('le', '72')).toBe(true)
    expect(t('eq', '72,0')).toBe(true)
    expect(t('between', '80', '60')).toBe(true)
    expect(t('gt', 'abc')).toBe(false)
  })

  it('Zahl: unbekannter Wert trifft nur «≠» und «leer»', () => {
    expect(matchesCondition(null, 'number', { field: 'age', op: 'gt', value: '1' }, ctx)).toBe(false)
    expect(matchesCondition(null, 'number', { field: 'age', op: 'ne', value: '1' }, ctx)).toBe(true)
    expect(matchesCondition(null, 'number', { field: 'age', op: 'empty' }, ctx)).toBe(true)
    expect(matchesCondition(0, 'number', { field: 'age', op: 'empty' }, ctx)).toBe(false)
  })

  it('Datum: relativ zu heute', () => {
    const d = (op: 'older_days' | 'within_days' | 'next_days', n: string, iso: string) => matchesCondition(iso, 'date', { field: 'birth', op, value: n }, ctx)
    expect(d('older_days', '30', '2026-10-01')).toBe(true)
    expect(d('older_days', '30', '2026-10-20')).toBe(false)
    expect(d('within_days', '30', '2026-10-20')).toBe(true)
    expect(d('within_days', '30', '2026-12-01')).toBe(false)
    expect(d('next_days', '14', '2026-11-20')).toBe(true)
    expect(d('next_days', '14', '2026-12-20')).toBe(false)
  })

  it('Datum: vor, nach, zwischen, am', () => {
    const t = (op: 'before' | 'after' | 'on' | 'between', v: string, v2?: string) => matchesCondition('2026-05-10', 'date', { field: 'birth', op, value: v, value2: v2 }, ctx)
    expect(t('before', '2026-06-01')).toBe(true)
    expect(t('after', '2026-06-01')).toBe(false)
    expect(t('on', '2026-05-10')).toBe(true)
    expect(t('between', '2026-05-01', '2026-05-31')).toBe(true)
    expect(t('before', '')).toBe(false)
  })

  it('Auswahl: mehrere Werte je Zeile, «ist nicht»', () => {
    const c = (op: 'is' | 'is_not', values: string[]) => ({ field: 'list', op, values })
    expect(matchesCondition(['a', 'b'], 'choice', c('is', ['b']), ctx)).toBe(true)
    expect(matchesCondition(['a'], 'choice', c('is', ['b']), ctx)).toBe(false)
    expect(matchesCondition(['a'], 'choice', c('is_not', ['b']), ctx)).toBe(true)
    expect(matchesCondition([], 'choice', c('is_not', ['b']), ctx)).toBe(true)
    expect(matchesCondition('w', 'choice', { field: 'sex', op: 'is', values: ['w', 'm'] }, ctx)).toBe(true)
    expect(matchesCondition(['a'], 'choice', c('is', []), ctx)).toBe(false)
  })

  it('Ja/Nein', () => {
    expect(matchesCondition(true, 'bool', { field: 'preg', op: 'yes' }, ctx)).toBe(true)
    expect(matchesCondition(false, 'bool', { field: 'preg', op: 'yes' }, ctx)).toBe(false)
    expect(matchesCondition(null, 'bool', { field: 'preg', op: 'no' }, ctx)).toBe(true)
  })
})

describe('matchesFilter', () => {
  it('«alle» und «eine davon»', () => {
    const c1 = { field: 'age', op: 'gt' as const, value: '72' }
    const c2 = { field: 'preg', op: 'yes' as const }
    expect(matchesFilter(row({ age: 80, pregnant: false }), filter('all', c1, c2), fields, ctx)).toBe(false)
    expect(matchesFilter(row({ age: 80, pregnant: true }), filter('all', c1, c2), fields, ctx)).toBe(true)
    expect(matchesFilter(row({ age: 10, pregnant: true }), filter('any', c1, c2), fields, ctx)).toBe(true)
    expect(matchesFilter(row({ age: 10, pregnant: false }), filter('any', c1, c2), fields, ctx)).toBe(false)
  })

  it('ohne Bedingungen oder mit unbekanntem Feld trifft nichts', () => {
    expect(matchesFilter(row(), filter('all'), fields, ctx)).toBe(false)
    expect(matchesFilter(row(), filter('all', { field: 'gibts_nicht', op: 'empty' }), fields, ctx)).toBe(false)
  })

  it('zählt Treffer', () => {
    const rows = [row({ age: 10 }), row({ age: 90 }), row({ age: 100 })]
    expect(countMatches(rows, filter('all', { field: 'age', op: 'gt', value: '72' }), fields, ctx)).toBe(2)
  })
})

describe('applyFilters', () => {
  const old: FilterDef = { id: 'old', name: 'Alt', color: 'rot', match: 'all', conditions: [{ field: 'age', op: 'gt', value: '72' }] }
  const preg: FilterDef = { id: 'preg', name: 'Trächtig', color: 'blau', match: 'all', conditions: [{ field: 'preg', op: 'yes' }] }

  it('«nur zeigen» blendet aus, «einfärben» sammelt Farben', () => {
    const r1 = applyFilters(row({ age: 80, pregnant: true }), [old, preg], { old: 'color', preg: 'color' }, fields, ctx)
    expect(r1).toEqual({ visible: true, colors: ['rot', 'blau'], names: ['Alt', 'Trächtig'] })
    const r2 = applyFilters(row({ age: 10 }), [old, preg], { old: 'only' }, fields, ctx)
    expect(r2.visible).toBe(false)
    const r3 = applyFilters(row({ age: 90, pregnant: false }), [old, preg], { old: 'only', preg: 'only' }, fields, ctx)
    expect(r3.visible).toBe(false)
  })

  it('ausgeschaltete Filter wirken nicht', () => {
    expect(applyFilters(row({ age: 10 }), [old], {}, fields, ctx)).toEqual({ visible: true, colors: [], names: [] })
  })
})

describe('Beschreibung und Hilfen', () => {
  it('beschreibt Bedingungen lesbar', () => {
    expect(describeCondition({ field: 'age', op: 'gt', value: '72' }, fields)).toBe('Alter > 72 Monate')
    expect(describeCondition({ field: 'list', op: 'is', values: ['a', 'b'] }, fields)).toBe('Merkliste ist Ausmerzen / Beobachten')
    expect(describeCondition({ field: 'birth', op: 'older_days', value: '30' }, fields)).toBe('Geburt vor mehr als 30 Tagen')
    expect(describeCondition({ field: 'birth', op: 'before', value: '2026-06-01' }, fields)).toBe('Geburt vor 01.06.2026')
    expect(describeCondition({ field: 'preg', op: 'yes' }, fields)).toBe('Trächtig ja')
    expect(describeFilter(filter('any', { field: 'preg', op: 'yes' }, { field: 'age', op: 'gt', value: '1' }), fields)).toBe('Trächtig ja oder Alter > 1 Monate')
  })

  it('Feldwechsel setzt eine passende Operation', () => {
    const next = retargetCondition({ field: 'age', op: 'gt', value: '5' }, fields.find((f) => f.key === 'preg')!)
    expect(next).toEqual({ field: 'preg', op: 'yes', value: undefined, value2: undefined, values: undefined })
    const keep = retargetCondition({ field: 'age', op: 'lt', value: '5' }, fields.find((f) => f.key === 'age')!)
    expect(keep.op).toBe('lt')
  })

  it('prüft Vollständigkeit', () => {
    expect(conditionComplete({ field: 'age', op: 'gt' })).toBe(false)
    expect(conditionComplete({ field: 'age', op: 'gt', value: '3' })).toBe(true)
    expect(conditionComplete({ field: 'age', op: 'between', value: '3' })).toBe(false)
    expect(conditionComplete({ field: 'list', op: 'is', values: [] })).toBe(false)
    expect(conditionComplete({ field: 'preg', op: 'yes' })).toBe(true)
  })
})
