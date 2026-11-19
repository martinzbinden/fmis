import { describe, expect, it } from 'vitest'
import { buildReaderDatabase, dbValues, DB_FIELDS } from './readerDatabase'
import type { ReaderEntry } from './readerLists'

const today = '2026-11-12'
const entry = (p: Partial<ReaderEntry> = {}): ReaderEntry => ({
  earTag: 'CH113900000103',
  laufNr: '101',
  group: 'Ablammgruppe',
  facts: { lastBirth: '2026-03-12', pregnancy: { date: '2026-10-10', result: 'ja' }, lastService: '2026-09-20', nursing: 1, idxPerformance: 101.4, performanceRel: 1.113 },
  ...p,
})

describe('dbValues', () => {
  it('ein Wert je Feld, Feld 1 ist die VID', () => {
    const v = dbValues(entry(), today)
    expect(v).toHaveLength(DB_FIELDS.length)
    expect(DB_FIELDS[0]).toMatchObject({ title: 'VID', type: 9 })
    expect(v).toEqual(['101 (0103) 245d 1L', 'Ablammgruppe', '245 Tage', '1 saugend', '12.03.26 (245 T)', '20.09.26 (53 T)', 'ja 10.10.26 (33 T)', '101 Pt - 111%', '9000.0010'])
  })

  it('trockengestellt, ohne Lämmer, Belegung und Untersuchung', () => {
    const v = dbValues(entry({ dry: true, facts: { lastBirth: '2026-03-12', pregnancy: null, nursing: 0 } }), today)
    expect(v[2]).toBe('trocken')
    expect(v[3]).toBe('')
    expect(v[5]).toBe('')
    expect(v[6]).toBe('keine US')
    expect(v[7]).toBe('')
  })

  it('ohne Geburt und ohne Daten bleibt fast alles leer, die VID nie', () => {
    const v = dbValues(entry({ facts: null, group: null }), today)
    expect(v[0]).toBe('101 (0103)')
    expect(v.slice(1, 8).every((x) => x === '')).toBe(true)
  })

  it('jeder Wert höchstens 20 Zeichen, ASCII ohne Trennzeichen', () => {
    const v = dbValues(entry({ laufNr: '12345678', group: 'Schlachtlämmer, Sonderaktion 2026' }), today)
    for (const x of v) {
      expect(x.length).toBeLessThanOrEqual(20)
      expect(x).toMatch(/^[\x20-\x7e]*$/)
      expect(x).not.toMatch(/[|[\],]/)
    }
  })
})

describe('buildReaderDatabase', () => {
  it('Zeilen mit 15-stelliger Ohrmarke, Tiere ohne verwertbare Marke fehlen', () => {
    const db = buildReaderDatabase([entry(), entry({ earTag: 'FR0099' })], today)
    expect(db.stats).toEqual({ animals: 1, noTag: 1 })
    expect(db.rows[0].iso).toMatch(/^\d{15}$/)
    expect(db.rows[0].values).toHaveLength(db.fields.length)
  })
})
