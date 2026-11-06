import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { utils } from 'xlsx'
import { isStockList, loadTagStock, orderFreeTags, readStockList, stockDateOf } from './earTagStock'

const s = (animal_key: string) => ({ animal_key })
const keys = (stock: { animal_key: string }[], used: string[] = []) => orderFreeTags(stock, new Set(used)).map((x) => x.animal_key)

describe('Ohrmarken-Vorrat', () => {
  it('erkennt den Lagerbestand, nicht den Tierbestand', () => {
    expect(isStockList(['Ohrmarken-Nr.', 'Ohrmarkentyp', 'Gattung', 'Individueller Text'])).toBe(true)
    expect(isStockList(['Ohrmarken-Nr.', 'Tiername', 'Geschlecht'])).toBe(false)
  })

  it('liest die Zellen auch bei falsch deklariertem Bereich', () => {
    const sheet = utils.aoa_to_sheet([
      ['Ohrmarken-Nr.', 'Ohrmarkentyp', 'Gattung', 'Individueller Text'],
      ['CH 120.9999.0001.4', 'Rinder: Doppelohrmarke', 'Rinder', '"Test"'],
      ['CH99990012', 'Schafe: mit Chip', 'Schafe', '"TEST"'],
      ['CH99990013', 'Ziegen', 'Ziegen', ''],
      ['', 'leer', 'Schafe', ''],
    ])
    sheet['!ref'] = 'A1:A1'
    const rows = readStockList({ SheetNames: ['Lagerbestand'], Sheets: { Lagerbestand: sheet } })!
    expect(rows.map((r) => [r.ear_tag, r.key, r.species])).toEqual([
      ['CH120999900014', 'CH120999900014', 'cattle'],
      ['CH99990012', 'CH99990012', 'sheep'],
      ['CH99990013', 'CH99990013', null],
    ])
  })

  it('lehnt andere Listen ab', () => {
    const sheet = utils.aoa_to_sheet([['Ohrmarken-Nr.', 'Tiername'], ['CH99990012', 'Test']])
    expect(readStockList({ SheetNames: ['a'], Sheets: { a: sheet } })).toBeNull()
  })

  it('nimmt den Stand aus dem Dateinamen', () => {
    expect(stockDateOf('2026-11-06_Ohrmarken_Lagerbestand.xlsx', '2026-12-01')).toBe('2026-11-06')
    expect(stockDateOf('lagerbestand.xlsx', '2026-12-01')).toBe('2026-12-01')
  })

  it('schlägt die längste Reihe aufsteigend vor, einzelne Reste zuletzt', () => {
    const stock = [s('CH99990103'), s('CH88880001'), s('CH99990101'), s('CH99990102')]
    expect(keys(stock)).toEqual(['CH99990101', 'CH99990102', 'CH99990103', 'CH88880001'])
  })

  it('erkennt Reihen bei Rindern trotz Prüfziffer', () => {
    const stock = [s('CH120777700019'), s('CH120999900015'), s('CH120999900023'), s('CH120999900031')]
    expect(keys(stock)).toEqual(['CH120999900015', 'CH120999900023', 'CH120999900031', 'CH120777700019'])
  })

  it('überspringt schon benutzte Marken', () => {
    const stock = [s('CH99990101'), s('CH99990102'), s('CH99990103')]
    expect(keys(stock, ['CH99990101'])).toEqual(['CH99990102', 'CH99990103'])
    expect(keys(stock, ['CH99990101', 'CH99990102', 'CH99990103'])).toEqual([])
  })

  it('gibt unbekannte Nummern zuletzt zurück', () => {
    expect(keys([s('DE12345'), s('CH99990101')])).toEqual(['CH99990101', 'DE12345'])
  })
})

describe('loadTagStock', () => {
  let pg: PGlite
  beforeAll(async () => {
    pg = new PGlite()
    await pg.exec(`
      create table ear_tag_stock (ear_tag text, animal_key text, stock_date date, deleted_at timestamptz);
      create table animals (ear_tag text, deleted_at timestamptz);
      create table birth_offspring (ear_tag text, deleted_at timestamptz);
      create table pedigree (animal_key text, deleted_at timestamptz);
    `)
  }, 60_000) // pglite startet im vollen Testlauf langsam
  afterAll(async () => {
    await pg.close()
  })

  it('ohne Liste kein Stand', async () => {
    expect(await loadTagStock(pg)).toEqual({ free: [], date: null })
  })

  it('zählt nur den neuesten Stand und lässt benutzte Marken aus', async () => {
    await pg.exec(`
      insert into ear_tag_stock values
        ('CH99990100', 'CH99990100', '2026-10-01', null),
        ('CH99990101', 'CH99990101', '2026-11-06', null),
        ('CH99990102', 'CH99990102', '2026-11-06', null),
        ('CH99990103', 'CH99990103', '2026-11-06', null),
        ('CH99990104', 'CH99990104', '2026-11-06', null),
        ('CH99990105', 'CH99990105', '2026-11-06', null);
      insert into animals values ('CH113999901011', null), ('CH99990105', now());
      insert into birth_offspring values ('CH99990102', null);
      insert into pedigree values ('CH99990103', null);
    `)
    expect(await loadTagStock(pg)).toEqual({ free: ['CH99990104', 'CH99990105'], date: '2026-11-06' })
  })
})
