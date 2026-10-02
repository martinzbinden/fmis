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
    { str: 'Farbe:', x: 422, y: 225 },
    { str: 'Parasitenresistenz:', x: 620, y: 225 },
    { str: 'Maedi Visna:', x: 620, y: 239 },
    { str: 'KK', x: 687, y: 239 },
    { str: 'CCR5:', x: 734, y: 239 },
    { str: 'NN', x: 772, y: 239 },
    { str: 'Anzahl Nachkommen', x: 489, y: 406 },
    { str: 'Männlich', x: 429, y: 417, w: 33 },
    { str: 'Weiblich', x: 486.6, y: 417, w: 31 },
    { str: 'Total', x: 549.5, y: 417, w: 19 },
    { str: 'Davon Zucht', x: 592.4, y: 417, w: 45 },
    { str: '12', x: 441, y: 428.6, w: 9 },
    { str: '10', x: 498, y: 428.6, w: 9 },
    { str: '22', x: 554, y: 428.6, w: 9 },
    { str: 'M: 0 F: 3', x: 597, y: 428.6, w: 36 },
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
    // Punktierung des Vaters (Altersklasse, Format, Fundament, ·, ·, Wolle)
    { str: '14.05.19', x: 17.8, y: 139.4 },
    { str: 'J', x: 60.4, y: 139.4 },
    { str: '4', x: 74.5, y: 139.4 },
    { str: '5', x: 88.7, y: 139.4 },
    { str: '5', x: 131.2, y: 139.4 },
    { str: 'Töchterleistungen nach Laktationen', x: 15, y: 262.9 },
    ...[['1. Laktation', '63', '291 Tage', '383', '6.96', '5.33', '50']].flatMap((r) =>
      r.map((str, i) => ({ str, x: [17.8, 74.5, 124.4, 178.6, 204.9, 233.3, 261.6][i], y: 278.3 })),
    ),
    // Mutter: LBE mit umbrochener Bemerkung, Laktation, Mittel, Lebensleistung
    { str: '02.05.23 91 / 90 / 89 / 80 / 87 Euterfülle: leer, Wollenfeinheit: ideal,', x: 15.8, y: 388.8 },
    { str: 'Schwanz: sehr lang', x: 15.8, y: 397.8 },
    { str: 'Milchleistung:', x: 15, y: 449.3 },
    ...['1', 'AT4', '14.04.20', '1.08', '264', '312', '7.98', '5.61', '40'].map((str, i) => ({
      str,
      x: [17.8, 34.9, 60.4, 110.9, 147.4, 178.6, 204.9, 233.3, 261.6][i],
      y: 462.5,
    })),
    ...['360', '360 ZWZ', '257 Tage', '355', '7.49', '5.38', '158'].map((str, i) => ({
      str,
      x: [17.8, 60.4, 124.4, 178.6, 204.9, 233.3, 261.6][i],
      y: 556.1,
    })),
    ...['LL', '7 Nachkommen', '1774', '7.49', '5.38'].map((str, i) => ({ str, x: [17.8, 60.4, 173.6, 204.9, 233.3][i], y: 567.4 })),
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

  it('liest Gesundheit und Nachkommen des Tiers', () => {
    expect(c.subject.info).toMatchObject({
      color: null,
      parasite_resistance: null,
      maedi_visna: 'KK',
      ccr5: 'NN',
      offspring_male: 12,
      offspring_female: 10,
      offspring_total: 22,
      offspring_breeding: 'M: 0 F: 3',
    })
  })

  it('liest Punktierungen, LBE und Leistungen in den Boxen', () => {
    const byPos = Object.fromEntries(c.ancestors.map((a) => [a.position, a]))
    expect(byPos.S.scores).toEqual([
      { kind: 'punktierung', date: '2019-05-14', age_class: 'J', format: 4, fundament: 5, udder: null, teats: null, wool: 5, total: null, defects: null, remarks: null },
    ])
    expect(byPos.S.performance).toEqual([
      expect.objectContaining({ kind: 'toechter', lactation_number: 1, count: 63, days: 291, milk_kg: 383, fat_pct: 6.96, protein_pct: 5.33, cell_count: 50 }),
    ])
    expect(byPos.D.scores).toEqual([
      expect.objectContaining({ kind: 'lbe', date: '2023-05-02', format: 91, fundament: 90, udder: 89, teats: 80, total: 87, remarks: 'Euterfülle: leer, Wollenfeinheit: ideal, Schwanz: sehr lang' }),
    ])
    expect(byPos.D.performance.map((p) => p.kind)).toEqual(['laktation', 'mittel', 'lebensleistung'])
    expect(byPos.D.performance[0]).toMatchObject({ lactation_number: 1, test_type: 'AT4', calving_date: '2020-04-14', age: '1.08', days: 264, milk_kg: 312, cell_count: 40 })
    expect(byPos.D.performance[1]).toMatchObject({ interval_days: 360, days: 257, milk_kg: 355, cell_count: 158 })
    expect(byPos.D.performance[2]).toMatchObject({ count: 7, milk_kg: 1774, fat_pct: 7.49 })
  })

  it('lehnt andere PDFs ab', () => {
    expect(() => parseSmgCertificate([{ width: W, height: H, items: [{ str: 'Rechnung', x: 0, y: 0 }] }], '2026-10-02')).toThrow()
  })
})
