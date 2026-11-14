import { describe, expect, it } from 'vitest'
import { applyFilters, matchesFilter } from '@fmis/core/filters/filterModel'
import { boardFields, boardPresets, buildColumns, cardsInColumn, columnKey, sortCards, type BoardCard } from './board'
import { clearTargets, draftSize, effectiveGroup, groupByTarget, pruneDraft, setTargets, summarizeDraft } from './boardDraft'

const card = (p: Partial<BoardCard> = {}): BoardCard => ({
  id: 'a',
  laufNr: '101',
  earTag: 'CH 000.0000.0101',
  shortTag: '0000.0101',
  name: null,
  sex: 'w',
  birthDate: '2020-01-01',
  ageMonths: 82,
  groupId: null,
  listIds: [],
  dry: false,
  nursing: 0,
  pregnancy: null,
  expectedBirth: null,
  lastBirth: null,
  daysSinceBirth: null,
  parity: 3,
  lactationNumber: 3,
  litterMean: null,
  lastLitterSize: null,
  ltlMilk: null,
  performanceRel: null,
  idxPerformance: null,
  scc12m: null,
  idxScc: null,
  sccRelPeers: null,
  levels: [],
  intervalDays: null,
  breedingValue: null,
  reasons: [],
  reasonScore: 0,
  healthDays12m: 0,
  ...p,
})

const refs = { groups: [{ id: 'g1', name: 'Melkgruppe' }, { id: 'g2', name: 'Galtgruppe' }], lists: [{ id: 'l1', name: 'Ausmerzen prüfen' }] }
const ctx = { today: '2026-11-10' }

describe('Felder und Vorlagen', () => {
  const fields = boardFields('dairy_schafe', 'sheep', refs)

  it('alle mitgelieferten Filter beziehen sich auf vorhandene Felder', () => {
    for (const p of boardPresets('sheep')) for (const c of p.conditions) expect(fields.some((f) => f.key === c.field), `${p.name}: ${c.field}`).toBe(true)
  })

  it('Vorlagen erkennen Trächtigkeit, Alter und Geburtstermin', () => {
    const presets = new Map(boardPresets('sheep').map((p) => [p.id, p]))
    const preg = card({ pregnancy: { result: 'ja', date: '2026-10-01', examiner: null, method: null, weeks: null } })
    expect(matchesFilter(preg, presets.get('p-pregnant')!, fields, ctx)).toBe(true)
    expect(matchesFilter(card(), presets.get('p-pregnant')!, fields, ctx)).toBe(false)
    expect(matchesFilter(card({ ageMonths: 80 }), presets.get('p-old')!, fields, ctx)).toBe(true)
    expect(matchesFilter(card({ ageMonths: 70 }), presets.get('p-old')!, fields, ctx)).toBe(false)
    expect(matchesFilter(card({ expectedBirth: '2026-11-25' }), presets.get('p-soon')!, fields, ctx)).toBe(true)
    expect(matchesFilter(card({ expectedBirth: '2027-02-01' }), presets.get('p-soon')!, fields, ctx)).toBe(false)
  })

  it('Gruppe ohne Zuordnung heisst «none»; Merklisten sind mehrwertig', () => {
    const g = fields.find((f) => f.key === 'group')!
    expect(g.get(card())).toBe('none')
    expect(g.get(card({ groupId: 'g1' }))).toBe('g1')
    const l = fields.find((f) => f.key === 'list')!
    expect(l.get(card({ listIds: ['l1', 'l2'] }))).toEqual(['l1', 'l2'])
  })

  it('Ausmerzbereiche aus den Gründen, ohne Doppel', () => {
    const area = fields.find((f) => f.key === 'area')!
    const reasons = [
      { area: 'euter' as const, weight: 2, text: 'x' },
      { area: 'euter' as const, weight: 1, text: 'y' },
      { area: 'alter' as const, weight: 0, text: 'z' },
    ]
    expect(area.get(card({ reasons }))).toEqual(['euter', 'alter'])
  })

  it('Einfärben und Ausblenden auf Karten', () => {
    const presets = boardPresets('sheep')
    const modes = { 'p-old': 'only' as const, 'p-dry': 'color' as const }
    expect(applyFilters(card({ ageMonths: 10 }), presets, modes, fields, ctx).visible).toBe(false)
    expect(applyFilters(card({ ageMonths: 90, dry: true }), presets, modes, fields, ctx)).toMatchObject({ visible: true, colors: ['grau'] })
  })

  it('Rinder: Begriffe passen zur Tierart', () => {
    const cattle = boardFields('dairy', 'cattle', refs)
    expect(cattle.find((f) => f.key === 'lastBirth')!.label).toBe('Letzte Abkalbung')
    expect(cattle.find((f) => f.key === 'litter')).toBeUndefined()
    expect(fields.find((f) => f.key === 'lastBirth')!.label).toBe('Letzte Ablammung')
  })
})

describe('Sortierung', () => {
  const a = card({ id: 'a', laufNr: '9', ageMonths: 30, lastBirth: '2026-03-01', expectedBirth: '2027-01-01', reasonScore: 1 })
  const b = card({ id: 'b', laufNr: '10', ageMonths: 100, lastBirth: '2026-06-01', expectedBirth: '2026-12-01', reasonScore: 5 })
  const c = card({ id: 'c', laufNr: null, earTag: 'CH 1', ageMonths: null, lastBirth: null, expectedBirth: null, reasonScore: 0 })

  it('nach Nummer natürlich, ohne Nummer am Ende', () => {
    expect(sortCards([c, b, a], 'nr').map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })
  it('Alter: älteste zuerst, unbekannt am Ende', () => {
    expect(sortCards([a, c, b], 'age').map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
  it('letzte Geburt: jüngste zuerst', () => {
    expect(sortCards([a, c, b], 'birth').map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
  it('erwartete Geburt: früheste zuerst', () => {
    expect(sortCards([a, c, b], 'expected').map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
  it('Ausmerz-Punkte: meiste zuerst', () => {
    expect(sortCards([a, c, b], 'score').map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('Spalten', () => {
  const lists = [
    { id: 'l1', name: 'Ausmerzen prüfen', color: null, notes: null, created_by: null, created_at: '', archived_at: null },
    { id: 'l2', name: 'Alt', color: null, notes: null, created_by: null, created_at: '', archived_at: '2026-01-01' },
  ]
  const cols = buildColumns(refs.groups, lists)

  it('Gruppen, «Ohne Gruppe», dann nicht archivierte Merklisten', () => {
    expect(cols.map((c) => c.key)).toEqual(['g:g1', 'g:g2', 'g:none', 'l:l1'])
    expect(columnKey('group', null)).toBe('g:none')
  })

  it('Karten je Spalte; Gruppe mit Entwurf', () => {
    const cards = [card({ id: 'a', groupId: 'g1', listIds: ['l1'] }), card({ id: 'b', groupId: null })]
    const groupOf = (id: string) => (id === 'b' ? 'g2' : 'g1')
    expect(cardsInColumn(cols[0], cards, groupOf).map((c) => c.id)).toEqual(['a'])
    expect(cardsInColumn(cols[1], cards, groupOf).map((c) => c.id)).toEqual(['b'])
    expect(cardsInColumn(cols[2], cards, groupOf)).toEqual([])
    expect(cardsInColumn(cols[3], cards, groupOf).map((c) => c.id)).toEqual(['a'])
  })
})

describe('Entwurf Gruppenwechsel', () => {
  const current = new Map<string, string | null>([
    ['a', 'g1'],
    ['b', 'g1'],
    ['c', null],
  ])

  it('setzt Ziele und lässt Tiere in ihrer Gruppe unberührt', () => {
    const d = setTargets({}, ['a', 'b', 'c'], 'g1', current)
    expect(d).toEqual({ c: 'g1' })
    expect(draftSize(d)).toBe(1)
  })

  it('zurück in die ursprüngliche Gruppe löscht den Eintrag', () => {
    let d = setTargets({}, ['a'], 'g2', current)
    expect(d).toEqual({ a: 'g2' })
    d = setTargets(d, ['a'], 'g1', current)
    expect(d).toEqual({})
  })

  it('«ohne Gruppe» ist ein gültiges Ziel', () => {
    const d = setTargets({}, ['a'], null, current)
    expect(d).toEqual({ a: null })
    expect(effectiveGroup(d, 'a', current)).toBeNull()
    expect(effectiveGroup(d, 'b', current)).toBe('g1')
  })

  it('fasst nach Herkunft und Ziel zusammen', () => {
    const d = setTargets({}, ['a', 'b', 'c'], 'g2', current)
    const names: Record<string, string> = { g1: 'Melk', g2: 'Galt' }
    const lines = summarizeDraft(d, current, (id) => (id ? names[id] : 'Ohne Gruppe'))
    // alphabetisch nach Herkunft: «Melk» vor «Ohne Gruppe»
    expect(lines).toEqual([
      { from: 'g1', to: 'g2', ids: ['a', 'b'] },
      { from: null, to: 'g2', ids: ['c'] },
    ])
  })

  it('gruppiert nach Ziel und räumt einzelne Tiere ab', () => {
    const d = setTargets({}, ['a', 'c'], 'g2', current)
    expect([...groupByTarget(d).entries()]).toEqual([['g2', ['a', 'c']]])
    expect(clearTargets(d, ['a'])).toEqual({ c: 'g2' })
  })

  it('streicht Überholtes', () => {
    const d = { a: 'g2', b: 'g1', c: 'weg', zzz: 'g2' } as Record<string, string | null>
    const pruned = pruneDraft(d, current, (id) => id !== 'weg')
    expect(pruned).toEqual({ a: 'g2' })
  })
})

describe('Zwischenablammzeit', () => {
  it('Mittel der Abstände, null unter zwei Geburten', async () => {
    const { birthInterval } = await import('./board')
    const b = (d: string) => ({ birth_date: d }) as never
    expect(birthInterval({ births: [b('2025-01-01')] })).toBeNull()
    expect(birthInterval({ births: [b('2025-01-01'), b('2025-12-27'), b('2026-12-22')] })).toBe(360)
  })
})
