import { describe, expect, it } from 'vitest'
import { checkYear, countCultures, cropInfo, parcelHints, type MainCrop } from './rotationRules'

const crop = (lineage: string, jahr: number, code: string, name: string | null, area = 100): MainCrop => ({
  lineage_id: lineage,
  farm_id: 'f',
  jahr,
  kultur_code: code,
  kultur_name_de: name,
  area_a: area,
  sequence_in_year: 1,
})

describe('cropInfo', () => {
  it('ordnet Kulturen den Gruppen der DZV zu', () => {
    expect(cropInfo('513', 'GiwR Winterweizen (BFF)')).toMatchObject({ label: 'Winterweizen', groups: ['getreide', 'weizen_korn'], open: true })
    expect(cropInfo('516', 'GiwR Dinkel (BFF)').groups).toEqual(['getreide', 'weizen_korn'])
    expect(cropInfo('502', 'Wintergerste').groups).toEqual(['getreide'])
    expect(cropInfo('504', 'GiwR Hafer (BFF)').groups).toEqual(['hafer'])
    expect(cropInfo('599', 'Silo- und Grünmais').groups).toEqual(['mais'])
    expect(cropInfo('599', 'Buchweizen').groups).toEqual([])
    expect(cropInfo('601', 'Kunstwiesen (ohne Weiden)')).toMatchObject({ kunstwiese: true, open: false })
    expect(cropInfo('569', null)).toMatchObject({ unknown: true, label: 'Code 569', groups: [] })
  })
})

describe('countCultures (Ziff. 4.1)', () => {
  it('zählt ab 10 %, kleine zusammen je 10 %, Kunstwiese doppelt/dreifach', () => {
    expect(countCultures([{ share: 0.4, kunstwiese: false }, { share: 0.6, kunstwiese: false }])).toBe(2)
    expect(countCultures([{ share: 0.06, kunstwiese: false }, { share: 0.07, kunstwiese: false }, { share: 0.87, kunstwiese: false }])).toBe(2)
    expect(countCultures([{ share: 0.25, kunstwiese: true }, { share: 0.75, kunstwiese: false }])).toBe(3)
    expect(countCultures([{ share: 0.67, kunstwiese: true }, { share: 0.33, kunstwiese: false }])).toBe(4)
  })
})

describe('checkYear', () => {
  it('rechnet Anteile an der Ackerfläche (offen + Kunstwiese) und die 3-ha-Grenze', () => {
    const r = checkYear(2026, [
      crop('a', 2026, '513', 'Winterweizen', 200),
      crop('b', 2026, '516', 'GiwR Dinkel (BFF)', 100),
      crop('c', 2026, '502', 'Wintergerste', 100),
      crop('d', 2026, '601', 'Kunstwiesen (ohne Weiden)', 200),
      crop('e', 2026, '613', 'Übrige Dauerwiesen', 500),
    ])
    expect(r.openHa).toBe(4)
    expect(r.arableHa).toBe(6)
    expect(r.applies).toBe(true)
    // Weizen 33 %, Dinkel 17 %, Gerste 17 %, Kunstwiese 33 % (zählt 3)
    expect(r.cultures).toBe(6)
    expect(r.shares.find((s) => s.rule.group === 'weizen_korn')).toMatchObject({ pct: 50, ok: true })
    expect(r.shares.find((s) => s.rule.group === 'getreide')).toMatchObject({ pct: 66.7, ok: false })
  })
})

describe('parcelHints (Ziff. 4.3)', () => {
  it('markiert Weizen zwei Jahre nacheinander und dreimal Getreide in Folge', () => {
    const hints = parcelHints([
      crop('a', 2023, '513', 'Winterweizen'),
      crop('a', 2024, '516', 'Dinkel'),
      crop('a', 2025, '502', 'Wintergerste'),
      crop('a', 2026, '601', 'Kunstwiesen (ohne Weiden)'),
    ])
    const by = (g: string) => hints.filter((h) => h.rule.group === g).map((h) => h.jahr).sort()
    expect(by('weizen_korn')).toEqual([2023, 2024])
    expect(by('getreide')).toEqual([2023, 2024, 2025])
  })
  it('lässt eine Fruchtfolge mit Pausen in Ruhe', () => {
    expect(
      parcelHints([
        crop('a', 2023, '513', 'Winterweizen'),
        crop('a', 2024, '601', 'Kunstwiesen (ohne Weiden)'),
        crop('a', 2025, '513', 'Winterweizen'),
        crop('a', 2026, '502', 'Wintergerste'),
      ]),
    ).toEqual([])
  })
})
