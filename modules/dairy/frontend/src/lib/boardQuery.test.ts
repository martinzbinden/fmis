import { describe, expect, it } from 'vitest'
import type { BoardCard } from './board'
import { describeCondition, matchesQuery, parseQuery, suggest, type QueryContext } from './boardQuery'

const card = (p: Partial<BoardCard>): BoardCard =>
  ({
    id: 'x', laufNr: '101', earTag: 'CH113999990017', shortTag: '9999.9001', name: null, sex: 'w', birthDate: '2019-01-01', ageMonths: 84, groupId: null, listIds: [], dry: false, nursing: 0,
    pregnancy: null, expectedBirth: null, lastBirth: null, daysSinceBirth: 100, parity: 3, lactationNumber: 3, litterMean: 2, lastLitterSize: 2, litterAlive: 2, litterDead: 0, ltlMilk: 0.8, performanceRel: 1.05,
    idxPerformance: 100, scc12m: 250, idxScc: 100, sccRelPeers: 120, levels: [], intervalDays: 365, lambMilk: null, breedingValue: 110, breedingEstimate: null, reasons: [], reasonScore: 0, healthDays12m: 0, ...p,
  }) as BoardCard
const ctx: QueryContext = { groupName: (c) => (c.groupId === 'g1' ? 'galt' : null), listNames: (c) => (c.listIds.includes('l1') ? ['Prüfen'] : []), meat: () => 159 }
const hits = (q: string, c: BoardCard) => matchesQuery(c, parseQuery(q), ctx)

describe('parseQuery', () => {
  it('Zahlenvergleich mit Alias: ZZ > 200', () => {
    const q = parseQuery('ZZ > 200')
    expect(q.conditions).toHaveLength(1)
    expect(q.errors).toHaveLength(0)
    expect(hits('ZZ > 200', card({ scc12m: 250 }))).toBe(true)
    expect(hits('ZZ > 200', card({ scc12m: 150 }))).toBe(false)
    expect(hits('ZZ > 200', card({ scc12m: null }))).toBe(false)
  })
  it('Zellzahl auch in Zellen je ml: 200000', () => {
    expect(hits('Zellzahl > 200000', card({ scc12m: 250 }))).toBe(true)
    expect(hits('Zellzahl > 200000', card({ scc12m: 150 }))).toBe(false)
  })
  it('Alter mit Einheit: Jahre, Monate, Tage', () => {
    expect(hits('Alter > 6 J', card({ ageMonths: 84 }))).toBe(true)
    expect(hits('Alter > 8 J', card({ ageMonths: 84 }))).toBe(false)
    expect(hits('Alter < 12 Mt', card({ ageMonths: 6 }))).toBe(true)
    expect(hits('Alter > 6', card({ ageMonths: 84 }))).toBe(true)
  })
  it('Wörter statt Zeichen: über, unter, ab, bis', () => {
    expect(hits('Laktation ab 3', card({ lactationNumber: 3 }))).toBe(true)
    expect(hits('Laktation unter 3', card({ lactationNumber: 3 }))).toBe(false)
    expect(hits('ZZ über 200', card({ scc12m: 250 }))).toBe(true)
  })
  it('mehrere Bedingungen mit und, & und ;', () => {
    expect(hits('ZZ > 200 und leer', card({ pregnancy: { result: 'nein' } as never }))).toBe(true)
    expect(hits('ZZ > 200 & leer', card({ pregnancy: { result: 'ja' } as never }))).toBe(false)
    expect(hits('ZZ > 200; Laktation >= 3', card({}))).toBe(true)
  })
  it('Merkmale ohne Wert und Freitext', () => {
    expect(hits('trächtig', card({ pregnancy: { result: 'ja' } as never }))).toBe(true)
    expect(hits('101', card({}))).toBe(true)
    expect(hits('999', card({}))).toBe(true)
    expect(hits('zzz', card({}))).toBe(false)
    expect(hits('101 und ZZ > 300', card({}))).toBe(false)
  })
  it('Auswahlfelder: Gruppe und Liste, auch nur der Anfang', () => {
    expect(hits('Gruppe = galt', card({ groupId: 'g1' }))).toBe(true)
    expect(hits('Gruppe = ga', card({ groupId: 'g1' }))).toBe(true)
    expect(hits('Gruppe != galt', card({ groupId: 'g1' }))).toBe(false)
    expect(hits('Liste = Prüfen', card({ listIds: ['l1'] }))).toBe(true)
  })
  it('Fleischwert über den Kontext', () => {
    expect(hits('Fleischwert > 150', card({}))).toBe(true)
    expect(hits('Fleischwert > 200', card({}))).toBe(false)
  })
  it('unbekanntes Feld oder falscher Wert: Fehler statt stiller Wirkung', () => {
    expect(parseQuery('Foo > 3').errors[0].reason).toMatch(/kein bekanntes Feld/)
    expect(parseQuery('ZZ > viel').errors[0].reason).toMatch(/keine Zahl/)
    expect(parseQuery('Gruppe > galt').errors[0].reason).toMatch(/nur = und !=/)
  })
  it('Komma als Dezimalzeichen', () => {
    expect(hits('Wurfmittel > 1,5', card({ litterMean: 2 }))).toBe(true)
  })
})

describe('describeCondition und suggest', () => {
  it('lesbare Beschreibung mit Einheit', () => {
    expect(describeCondition(parseQuery('ZZ > 200').conditions[0])).toBe('Zellzahl Ø 12 Monate > 200 Tsd./ml')
    expect(describeCondition(parseQuery('Alter > 6 J').conditions[0])).toBe('Alter > 6 J')
  })
  it('Vorschläge: leer → Beispiele, Feldanfang → Felder, Feld → Operatoren', () => {
    expect(suggest('').length).toBeGreaterThan(3)
    expect(suggest('zel').some((s) => /Zellzahl/.test(s.label))).toBe(true)
    expect(suggest('ZZ').map((s) => s.insert)).toContain('ZZ > ')
    expect(suggest('ZZ > 200 und lak').some((s) => /Laktation/.test(s.label))).toBe(true)
  })
})
