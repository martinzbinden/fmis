import { describe, expect, it } from 'vitest'
import { formatSpec, parsePaste, readDate, readNumber, resolveArea, type PasteImporter } from './pasteImport'

const imp = (area: string) => ({ area, label: area, description: '', permission: 'x', fields: [{ name: 'a', type: 'Text', description: 'A', required: true }], example: [{ a: 1 }] }) as unknown as PasteImporter
const mods = [
  { key: 'dairy', title: 'Kühe', pasteImporters: [imp('behandlungen')] },
  { key: 'dairy_schafe', title: 'Schafe', pasteImporters: [imp('behandlungen')] },
  { key: 'wiesenjournal', title: 'WJ', pasteImporters: [imp('maschinenjournal')] },
]

describe('parsePaste', () => {
  it('ein Block, Liste von Blöcken, Markdown-Codeblock', () => {
    expect(parsePaste('{"fmis_import":1,"bereich":"dairy.behandlungen","daten":[{"x":1}]}')).toEqual([{ bereich: 'dairy.behandlungen', quelle: null, daten: [{ x: 1 }] }])
    expect(parsePaste('```json\n[{"bereich":"a","daten":[]},{"bereich":"b","quelle":"q","daten":[]}]\n```')).toHaveLength(2)
  })
  it('verständliche Fehler', () => {
    expect(() => parsePaste('')).toThrow(/Nichts/)
    expect(() => parsePaste('{"bereich":"a","daten":[1]}')).toThrow(/Datensatz 1/)
    expect(() => parsePaste('{"daten":[]}')).toThrow(/bereich/)
    expect(() => parsePaste('{"bereich":"a","daten":{}}')).toThrow(/Liste/)
    expect(() => parsePaste('{"bereich": "a",\n "daten": [}')).toThrow(/Kein gültiges JSON/)
    expect(() => parsePaste('{"fmis_import":2,"bereich":"a","daten":[]}')).toThrow(/Formatversion/)
  })
})

describe('resolveArea', () => {
  it('mit Modul eindeutig, ohne nur wenn eindeutig', () => {
    expect(resolveArea('dairy_schafe.behandlungen', mods).mod.key).toBe('dairy_schafe')
    expect(resolveArea('maschinenjournal', mods).mod.key).toBe('wiesenjournal')
    expect(() => resolveArea('behandlungen', mods)).toThrow(/mehrdeutig/)
    expect(() => resolveArea('dairy.gibtsnicht', mods)).toThrow(/Unbekannter Bereich.*dairy.behandlungen/)
  })
})

describe('Hilfen', () => {
  it('Datum und Zahl', () => {
    expect(readDate('7.10.2026').value).toBe('2026-10-07')
    expect(readDate('2026-02-30').error).toMatch(/gibt es nicht/)
    expect(readDate('').value).toBeNull()
    expect(readNumber('12,5').value).toBe(12.5)
    expect(readNumber("1'200").value).toBe(1200)
    expect(readNumber('abc').error).toBeTruthy()
  })
  it('Formatbeschreibung enthält Bereich, Felder und Beispiel', () => {
    const s = formatSpec('dairy', 'Kühe', imp('behandlungen'))
    expect(s).toContain('Bereich: dairy.behandlungen')
    expect(s).toContain('- a (Pflicht) — Text: A')
    expect(s).toContain('"fmis_import": 1')
  })
})
