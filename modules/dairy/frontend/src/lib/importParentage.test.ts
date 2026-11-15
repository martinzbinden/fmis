import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { importLaufNr, isSmgAnimalList, laufNrOf, parseParentCell, parseSmgAnimalList, tvdParentColumns, type ParentageRow } from './importParentage'

// Schreiben abfangen: geprüft wird, was importLaufNr schreiben will
const written: Record<string, unknown>[] = []
vi.mock('./importMerge', () => ({
  writeImportRow: async (_pg: unknown, _t: string, row: Record<string, unknown>) => {
    written.push(row)
    return true
  },
}))

describe('Abstammung aus Tierlisten', () => {
  it('liest Elternzellen der SMG-Tierliste', () => {
    expect(parseParentCell('9000.0050 EUGEN')).toEqual({ key: 'CH90000050', ear_tag: '9000.0050', name: 'EUGEN' })
    expect(parseParentCell('9000.0100 ')).toEqual({ key: 'CH90000100', ear_tag: '9000.0100', name: null })
    expect(parseParentCell('')).toBeNull()
    expect(parseParentCell('unbekannt')).toBeNull()
  })
  it('erkennt die SMG-Tierliste und liest Tier, Geburt, Geschlecht, Eltern', () => {
    expect(isSmgAnimalList(['Nr.', 'Orig.-Nr.', 'Name', 'Vater', 'Mutter'])).toBe(true)
    expect(isSmgAnimalList(['Ohrmarkennummer', 'Tiername'])).toBe(false)
    const [r] = parseSmgAnimalList([{ 'Nr.': 2217, 'Orig.-Nr.': '9000.0170', Name: '', 'Geb.-Dat': '06.11.2022', 'Ges.': 'F', Vater: '9000.0050 EUGEN', Mutter: '9000.0100 ' }])
    expect(r).toMatchObject({ key: 'CH90000170', birth_date: '2022-11-06', sex: 'w', sire: { key: 'CH90000050', name: 'EUGEN' }, dam: { key: 'CH90000100' } })
  })
  it('liest die Laufnummer (Spalte «Nr.») und das Geburtsdatum aus «Geb.-Dat.»', () => {
    expect(laufNrOf(417)).toBe('417')
    expect(laufNrOf('417.0')).toBe('417')
    expect(laufNrOf('')).toBeNull()
    expect(laufNrOf(null)).toBeNull()
    const [r] = parseSmgAnimalList([{ 'Nr.': 417, 'Orig.-Nr.': '9000.0170', 'Geb.-Dat.': '06.11.2022', Vater: '', Mutter: '' }])
    expect(r).toMatchObject({ lauf_nr: '417', birth_date: '2022-11-06' })
  })
  it('findet Mutter/Vater-Spalten einer TVD-Liste, falls es sie gibt', () => {
    expect(tvdParentColumns(['Ohrmarkennummer', 'Tiername', 'Ohrmarke Mutter', 'Vater'])).toEqual({ dam: 'Ohrmarke Mutter', sire: 'Vater' })
    expect(tvdParentColumns(['Ohrmarkennummer', 'Tiername', 'Geschlecht'])).toEqual({ dam: null, sire: null })
  })
})

describe('importLaufNr', () => {
  let pg: PGlite
  beforeAll(async () => {
    pg = new PGlite()
    await pg.exec(`
      create table animals (id text primary key, ear_tag text, lauf_nr text, status text, birth_date date, entry_date date, exit_date date, deleted_at timestamptz);
      insert into animals values
        ('a', 'CH90000170', '2417', 'aktiv', '2022-11-06', null, null, null),
        ('b', 'CH90000180', null, 'aktiv', null, null, null, null),
        ('c', 'CH90000190', '2001', 'aktiv', null, null, null, null),
        ('d', 'CH90000200', '500', 'aktiv', null, null, null, null);
    `)
  }, 60_000)
  afterAll(async () => {
    await pg.close()
  })
  const row = (tag: string, nr: string | null): ParentageRow => ({ key: tag, ear_tag: tag, name: null, birth_date: null, sex: null, sire: null, dam: null, lauf_nr: nr })

  it('übernimmt neue Nummern, lässt gleiche und leere, gibt keine Nummer doppelt', async () => {
    written.length = 0
    const r = await importLaufNr(pg, [row('CH90000170', '417'), row('CH90000180', '418'), row('CH90000190', '2001'), row('CH90000210', '999'), row('CH90000200', null), row('CH90000180x', null)])
    expect(r.changed).toBe(2)
    expect(written.map((w) => [w.id, w.lauf_nr, w.birth_date])).toEqual([
      ['a', '417', '2022-11-06'],
      ['b', '418', null],
    ])
    // Nummer schon bei einem anderen Tier, das selbst keine neue bekommt
    written.length = 0
    const c = await importLaufNr(pg, [row('CH90000180', '500')])
    expect(c.changed).toBe(0)
    expect(c.conflicts).toHaveLength(1)
  })
})
