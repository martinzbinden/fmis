import { describe, expect, it } from 'vitest'
import { matchesQuery, parseQuery, sortBySuggestion, suggest, suggestSort, type QueryField } from './engine'

interface Row {
  name: string
  area: number | null
  type: string
  active: boolean
}
const fields: QueryField<Row, null>[] = [
  { kind: 'num', key: 'area', label: 'Fläche', unit: 'ha', aliases: ['flaeche', 'ha'], example: 'Fläche > 2', get: (r) => r.area },
  { kind: 'choice', key: 'type', label: 'Art', aliases: ['art', 'typ'], options: (r) => [r.type] },
  { kind: 'flag', key: 'aktiv', label: 'aktiv', aliases: ['aktiv'], test: (r) => r.active },
]
const rows: Row[] = [
  { name: 'Hofstatt', area: 3.2, type: 'Wiese', active: true },
  { name: 'Acker Nord', area: 1.1, type: 'Acker', active: false },
  { name: 'Weide', area: null, type: 'Weide', active: true },
]
const run = (q: string) => rows.filter((r) => matchesQuery(r, parseQuery(fields, q), null, (x) => [x.name])).map((r) => r.name)

describe('generische Engine', () => {
  it('Zahlen, Auswahl, Merkmal und Freitext', () => {
    expect(run('Fläche > 2')).toEqual(['Hofstatt'])
    expect(run('ha < 2')).toEqual(['Acker Nord'])
    expect(run('Art = acker')).toEqual(['Acker Nord'])
    expect(run('aktiv und ha > 1')).toEqual(['Hofstatt'])
    expect(run('acker')).toEqual(['Acker Nord'])
  })
  it('Sortierempfehlung: «>» absteigend, «<» aufsteigend, Datensätze ohne Wert zuletzt', () => {
    const s = suggestSort(parseQuery(fields, 'Fläche > 1'))!
    expect(s.desc).toBe(true)
    expect(s.label).toBe('Fläche ↓')
    expect([...rows].sort(sortBySuggestion(s, null)).map((r) => r.name)).toEqual(['Hofstatt', 'Acker Nord', 'Weide'])
    const a = suggestSort(parseQuery(fields, 'Fläche < 5'))!
    expect([...rows].sort(sortBySuggestion(a, null)).map((r) => r.name)).toEqual(['Acker Nord', 'Hofstatt', 'Weide'])
    expect(suggestSort(parseQuery(fields, 'aktiv'))).toBeNull()
    expect(suggestSort(parseQuery(fields, 'Fläche = 3'))).toBeNull()
  })
  it('Vorschläge', () => {
    expect(suggest(fields, 'fl').some((x) => x.label === 'Fläche')).toBe(true)
    expect(suggest(fields, 'Art = ', { type: ['Wiese', 'Acker'] }).length).toBe(2)
  })
})
