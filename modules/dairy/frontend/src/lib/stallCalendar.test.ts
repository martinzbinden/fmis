import { describe, expect, it } from 'vitest'
import type { Lamb } from './lambs'
import { buildFeedingPlan, buildStallHints, dueState, latestDecision, rearing, type StallDecision } from './stallCalendar'
import { DEFAULT_STALL_RULES } from './stallRules'

const TODAY = '2026-04-20'
const sheep = DEFAULT_STALL_RULES.sheep
const cattle = DEFAULT_STALL_RULES.cattle

const lamb = (key: string, ageDays: number, over: Partial<Lamb> = {}): Lamb => ({
  key,
  offspringId: key,
  animalId: null,
  earTag: null,
  lauf_nr: null,
  name: null,
  sex: 'w',
  birthDate: new Date(Date.parse(`${TODAY}T12:00:00Z`) - ageDays * 86_400_000).toISOString().slice(0, 10),
  ageDays,
  damId: 'm1',
  litter: 1,
  litterIndex: 1,
  reportedAt: null,
  birthWeight: null,
  weights: [],
  gainPerDay: null,
  weanDate: null,
  nursing: true,
  ...over,
})
const decision = (key: string, d: StallDecision['decision'], over: Partial<StallDecision> = {}): StallDecision => ({
  step: 'eimer',
  offspringId: key,
  animalId: null,
  decision: d,
  decidedOn: TODAY,
  until: null,
  ...over,
})
const hintOf = (kind: string, hints: ReturnType<typeof buildStallHints>) => hints.find((h) => h.kind === kind)?.items.map((i) => i.key) ?? []
const run = (lambs: Lamb[], decisions: StallDecision[] = [], species: 'sheep' | 'cattle' = 'sheep', extra: Partial<Parameters<typeof buildStallHints>[0]> = {}) =>
  buildStallHints({ lambs, decisions, expected: [], dryIds: new Set(), species, rules: species === 'sheep' ? sheep : cattle, today: TODAY, ...extra })

describe('Lämmer: Eimer fragen', () => {
  it('ab Tag 10, mit 3 Tagen Vorlauf', () => {
    const h = run([lamb('a', 6), lamb('b', 7), lamb('c', 10), lamb('d', 14)])
    expect(hintOf('eimer', h).sort()).toEqual(['b', 'c', 'd'])
  })
  it('nach dem Fenster (Tag 25 und älter) gilt: bei der Mutter, kein Eimer-Hinweis', () => {
    const h = run([lamb('alt', 30)])
    expect(hintOf('eimer', h)).toEqual([])
  })
  it('Entscheid Eimer oder Mutter beendet die Frage', () => {
    const h = run([lamb('a', 11), lamb('b', 11)], [decision('a', 'eimer'), decision('b', 'mutter')])
    expect(hintOf('eimer', h)).toEqual([])
  })
  it('«später» blendet aus bis zum Datum, dann kommt die Frage wieder', () => {
    const l = lamb('a', 12)
    expect(hintOf('eimer', run([l], [decision('a', 'spaeter', { until: '2026-04-23' })]))).toEqual([])
    expect(hintOf('eimer', run([l], [decision('a', 'spaeter', { until: '2026-04-20' })]))).toEqual(['a'])
  })
  it('der neueste Entscheid gilt', () => {
    const l = lamb('a', 12)
    const ds = [decision('a', 'spaeter', { decidedOn: '2026-04-18', until: '2026-04-19' }), decision('a', 'eimer', { decidedOn: '2026-04-20' })]
    expect(latestDecision(ds, 'eimer', l)?.decision).toBe('eimer')
    expect(hintOf('eimer', run([l], ds))).toEqual([])
  })
  it('abgesetzte oder nicht saugende Tiere bekommen nichts', () => {
    expect(run([lamb('a', 12, { nursing: false, weanDate: '2026-04-19' })])).toEqual([])
  })
})

describe('Lämmer: Absetzen bei der Mutter', () => {
  it('nur wenn bei der Mutter aufgezogen, ab Tag 40 (mit Vorlauf)', () => {
    const lambs = [lamb('m36', 36), lamb('m37', 37), lamb('e45', 45), lamb('x45', 45)]
    const h = run(lambs, [decision('m36', 'mutter'), decision('m37', 'mutter'), decision('e45', 'eimer')])
    // x45 ohne Entscheid und älter als Tag 24: gilt als bei der Mutter
    expect(hintOf('absetzen', h).sort()).toEqual(['m37', 'x45'])
  })
  it('Eimer-Lämmer werden nicht abgesetzt', () => {
    expect(hintOf('absetzen', run([lamb('e', 50)], [decision('e', 'eimer')]))).toEqual([])
  })
})

describe('Rearing', () => {
  it('offen bis Tag 24, dann «Mutter»', () => {
    expect(rearing([], lamb('a', 24), sheep, TODAY)).toBe('offen')
    expect(rearing([], lamb('a', 25), sheep, TODAY)).toBe('mutter')
  })
})

describe('Kälber', () => {
  it('Milchzusatz bis Tag 30 und Abtränken ab ca. 3,5 Monaten', () => {
    const lambs = [lamb('jung', 10), lamb('z', 28), lamb('alt', 60), lamb('tr', 104), lamb('t2', 106)]
    const h = run(lambs, [], 'cattle')
    expect(hintOf('milchzusatz', h).sort()).toEqual(['alt', 't2', 'tr', 'z'])
    expect(hintOf('abtraenken', h).sort()).toEqual(['t2', 'tr'])
  })
  it('Milchzusatz beendet verschwindet', () => {
    const h = run([lamb('z', 40)], [decision('z', 'erledigt', { step: 'milchzusatz' })], 'cattle')
    expect(hintOf('milchzusatz', h)).toEqual([])
  })
})

describe('Trockenstellen', () => {
  const animal = { id: 'k1', ear_tag: 'CH1', lauf_nr: '1', name: null }
  it('vor der erwarteten Geburt, nicht bei trockenen', () => {
    const exp = [{ animal, from: '2026-06-17', to: '2026-06-17' }]
    // 60 Tage vorher = 18.4.; Vorlauf 3 Tage
    expect(hintOf('trockenstellen', run([], [], 'cattle', { expected: exp }))).toEqual(['k1'])
    expect(hintOf('trockenstellen', run([], [], 'cattle', { expected: exp, dryIds: new Set(['k1']) }))).toEqual([])
    expect(hintOf('trockenstellen', run([], [], 'cattle', { expected: [{ animal, from: '2026-09-01', to: '2026-09-01' }] }))).toEqual([])
  })
})

describe('dueState', () => {
  it('überfällig, heute, bald', () => {
    expect(dueState('2026-04-19', TODAY)).toBe('ueberfaellig')
    expect(dueState(TODAY, TODAY)).toBe('heute')
    expect(dueState('2026-04-21', TODAY)).toBe('bald')
  })
})

describe('Tränkeplan', () => {
  it('Schafe: neu, Eimer, bei der Mutter', () => {
    const lambs = [lamb('n', 3), lamb('e', 12), lamb('m', 20)]
    const plan = buildFeedingPlan(lambs, [decision('e', 'eimer'), decision('m', 'mutter')], 'sheep', sheep, TODAY)
    expect(plan.map((p) => p.key)).toEqual(['neu', 'eimer', 'mutter'])
    expect(plan[0].lambs[0].next?.text).toBe('Eimer oder Mutter?')
    expect(plan[2].lambs[0].next?.text).toBe('Absetzen')
  })
  it('Kälber: Milch + Zusatz, danach Milch bis Abtränken', () => {
    const plan = buildFeedingPlan([lamb('a', 10), lamb('b', 50)], [], 'cattle', cattle, TODAY)
    expect(plan.map((p) => p.key)).toEqual(['zusatz', 'milch'])
    expect(plan[1].lambs[0].next).toEqual({ text: 'Abtränken', due: '2026-06-15' })
  })
})
