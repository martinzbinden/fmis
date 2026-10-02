import { describe, expect, it } from 'vitest'
import { certificateEarTag, parseSmgCertificate, type PdfItem, type PdfPageText } from './smgCertificate'

// Synthetischer Ausweis nach dem Layout der SMG (A4 quer, 842 × 595 pt) —
// erfundene Tiere, keine Betriebsdaten.
const W = 842
const H = 595
const COL_X = [15, 290, 565]
const TOP = 82.9
const SLOT = [250, 125, 62.5]

function box(col: number, slot: number, header: string, id: string, date: string, zw: string | null): PdfItem[] {
  const x = COL_X[col]
  const y = TOP + slot * SLOT[col]
  const items: PdfItem[] = [
    { str: header, x, y },
    { str: id, x, y: y + 12 },
    { str: '100 % LAC', x: x + 167, y: y + 12 },
    { str: date, x: x + 224, y: y + 12 },
  ]
  if (zw) items.push({ str: 'ZW:', x, y: y + 24 }, { str: zw, x: x + 22, y: y + 24 }, { str: 'ZF:', x: x + 167, y: y + 24 })
  return items
}

const page1: PdfPageText = {
  width: W,
  height: H,
  items: [
    { str: 'Abstammungs – und Leistungsausweis', x: 28, y: 60 },
    { str: 'Name:', x: 422, y: 131.7 },
    { str: 'TESTBOCK HB', x: 530, y: 131.7 },
    { str: 'Nummer/Zeichen:', x: 422, y: 150 },
    { str: '9999.0001', x: 530, y: 150 },
    { str: 'Geburtsdatum:', x: 422, y: 168 },
    { str: '01.03.2022', x: 530, y: 168 },
    { str: 'Rasse:', x: 422, y: 182 },
    { str: 'LAC 100.00%', x: 530, y: 182 },
    { str: 'Inzuchtgrad:', x: 422, y: 210 },
    { str: '1.56 %', x: 530, y: 210 },
    { str: '15.05.2026', x: 718, y: 578 },
  ],
}

const page2: PdfPageText = {
  width: W,
  height: H,
  items: [
    { str: 'TESTBOCK HB', x: 18, y: 41 },
    { str: '9999.0001', x: 356, y: 41 },
    ...box(0, 0, 'VATER HB weiss', '9999.0002', '07.01.18 2', '2026 93% 98 103 100 101'),
    ...box(0, 1, 'HB weiss', '9999.0003', '06.08.18 2', '2026 77% 91 111 93 98'),
    ...box(1, 0, 'GROSSVATER HB weiss', '9999.0004', '09.01.15 2', '2026 90% 108 95 105 104'),
    // Mutter des Vaters unbekannt (Slot 1 leer), Muttersvater ausländisch
    ...box(1, 2, 'IMPORT HB', '123.456.789 AT', '28.01.96 2', null),
    ...box(2, 7, 'HB', '99990005', '05.09.11', '2026 81% 82 105 94 91'),
  ],
}

describe('certificateEarTag', () => {
  it('normalisiert Schweizer und ausländische Nummern', () => {
    expect(certificateEarTag('2004.5434')).toBe('CH20045434')
    expect(certificateEarTag('372.457.830 AT')).toBe('AT372457830')
    expect(certificateEarTag('20010495')).toBe('20010495')
  })
})

describe('parseSmgCertificate', () => {
  const c = parseSmgCertificate([page1, page2], '2026-10-02')

  it('liest das Tier von Seite 1', () => {
    expect(c.subject).toMatchObject({ ear_tag: 'CH99990001', name: 'TESTBOCK', birth_date: '2022-03-01', breed_code: 'LAC' })
    expect(c.document_date).toBe('2026-05-15')
    expect(c.inbreeding_pct).toBe(1.56)
  })

  it('ordnet die Vorfahren nach ihrer Box im Raster zu', () => {
    const byPos = Object.fromEntries(c.ancestors.map((a) => [a.position, a]))
    expect(Object.keys(byPos).sort()).toEqual(['D', 'DDD', 'DS', 'S', 'SS'])
    expect(byPos.S).toMatchObject({ ear_tag: 'CH99990002', name: 'VATER', birth_date: '2018-01-07' })
    expect(byPos.S.breeding_values).toEqual({ year: 2026, reliability: 93, idx_milk: 98, idx_fat_pct: 103, idx_protein_pct: 100, gzw: 101 })
    expect(byPos.D).toMatchObject({ ear_tag: 'CH99990003', name: null })
    expect(byPos.DS).toMatchObject({ ear_tag: 'AT123456789', name: 'IMPORT', birth_date: '1996-01-28', breeding_values: null })
    expect(byPos.DDD.ear_tag).toBe('99990005')
  })

  it('lehnt andere PDFs ab', () => {
    expect(() => parseSmgCertificate([{ width: W, height: H, items: [{ str: 'Rechnung', x: 0, y: 0 }] }], '2026-10-02')).toThrow()
  })
})
