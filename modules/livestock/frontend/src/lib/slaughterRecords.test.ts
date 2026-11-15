import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/write', () => ({ upsertRows: vi.fn() }))
vi.mock('@fmis/core/db', () => ({ getSharedDbRaw: vi.fn() }))

import { ageAt, byAge, byClassification, byLactation, bySeason, deliveries, lactationDaysAt, stats, type AnimalInfo, type SlaughterRecord } from './slaughterRecords'
import { checkSlaughter, readCategory } from './pasteSlaughter'

const rec = (p: Partial<SlaughterRecord>): SlaughterRecord => ({
  id: Math.random().toString(36),
  slaughter_date: '2026-08-27',
  ear_tag: null,
  animal_key: null,
  category: 'Lamm',
  carcass_kg: 15,
  classification: 'T2',
  price_per_kg: 12,
  amount: 180,
  remark: null,
  buyer: 'Schlachtbetrieb',
  settlement_no: '100001',
  weigh_slip_no: null,
  source: 'import',
  notes: null,
  ...p,
})

const info = new Map<string, AnimalInfo>([
  ['CH99990001', { birth_date: '2026-05-01', sex: 'm', births: [] }], // 118 Tage am 27.8.
  ['CH99990002', { birth_date: '2026-03-20', sex: 'w', births: [] }], // 160 Tage
  ['CH99990003', { birth_date: '2021-02-01', sex: 'w', births: ['2025-01-10', '2026-06-01'] }], // 87 Laktationstage
])

describe('Schlachtungen auswerten', () => {
  it('Mittel, Spanne, Preis, Betrag', () => {
    const s = stats([rec({ carcass_kg: 14 }), rec({ carcass_kg: 17, price_per_kg: 14 }), rec({ carcass_kg: null, amount: null })])
    expect(s).toMatchObject({ n: 3, withKg: 2, meanKg: 15.5, minKg: 14, maxKg: 17, meanPrice: 12.67, amount: 360 })
  })

  it('Alter und Laktationstage am Schlachttag', () => {
    expect(ageAt(rec({ animal_key: 'CH99990001' }), info)).toBe(118)
    expect(ageAt(rec({ animal_key: 'CH99990009' }), info)).toBeNull()
    expect(lactationDaysAt(rec({ animal_key: 'CH99990003', category: 'Schaf' }), info)).toBe(87)
    // Geburt nach dem Schlachttag zählt nicht
    expect(lactationDaysAt(rec({ animal_key: 'CH99990003', slaughter_date: '2026-05-01' }), info)).toBe(476)
  })

  it('gruppiert nach Alter, Laktationstagen, Jahreszeit, Taxation', () => {
    const rows = [rec({ animal_key: 'CH99990001', carcass_kg: 15 }), rec({ animal_key: 'CH99990002', carcass_kg: 18 }), rec({ carcass_kg: 12 })]
    expect(byAge(rows, info).map((g) => [g.label, g.stats.meanKg])).toEqual([
      ['bis 120 Tage', 15],
      ['151–210 Tage', 18],
      ['Alter unbekannt', 12],
    ])
    expect(byLactation([rec({ animal_key: 'CH99990003', category: 'Schaf', carcass_kg: 22 })], info)[0].label).toBe('61–120 Tage')
    expect(bySeason([rec({ slaughter_date: '2026-01-19' }), rec({})]).map((g) => g.key)).toEqual(['q1', 'q3'])
    expect(byClassification([rec({ classification: 'T2' }), rec({ classification: null })]).map((g) => g.label)).toEqual(['T2', 'ohne Taxation'])
  })

  it('Lieferungen je Datum, Abnehmer und Abrechnung, neueste zuerst', () => {
    const d = deliveries([rec({}), rec({ category: 'Schaf' }), rec({ slaughter_date: '2026-11-05', settlement_no: '100002' })])
    expect(d.map((x) => [x.date, x.stats.n])).toEqual([
      ['2026-11-05', 1],
      ['2026-08-27', 2],
    ])
    expect(d[1].categories).toEqual({ Lamm: 1, Schaf: 1 })
  })
})

describe('Schlachtungen einfügen', () => {
  it('liest Kategorien tolerant', () => {
    expect(readCategory('Schaf (SM)')).toBe('Schaf')
    expect(readCategory('LA')).toBe('Lamm')
    expect(readCategory('Lamm; klein')).toBe('Lamm')
    expect(readCategory('Rind')).toBe('Rind')
    expect(readCategory('Pferd')).toBeNull()
  })

  it('prüft Pflichtfelder, Doppelte und Plausibilität', () => {
    const rows = checkSlaughter(
      [
        { datum: '2026-08-27', kategorie: 'Lamm', ohrmarke: '9999.0001', schlachtgewicht_kg: 15.5, taxation: 't 2', preis_kg: 12, betrag: 186 },
        { datum: '2026-08-27', kategorie: 'Lamm', ohrmarke: '99990001', schlachtgewicht_kg: 15.5 },
        { datum: '2026-08-27', kategorie: 'Lamm', ohrmarke: '9999.0002', schlachtgewicht_kg: 60 },
        { datum: '27.08.2026', kategorie: 'Schaf', ohrmarke: '9999.0003', schlachtgewicht_kg: 21, preis_kg: 6.9, betrag: 100 },
        { kategorie: 'Pferd' },
        { datum: '2026-08-27', kategorie: 'Lamm', ohrmarke: '9999.0004' },
      ],
      [{ slaughter_date: '2026-08-27', animal_key: 'CH99990004' }],
    )
    expect(rows.map((r) => r.status)).toEqual(['neu', 'doppelt', 'neu', 'neu', 'fehler', 'doppelt'])
    expect(rows[0].value).toMatchObject({ animal_key: 'CH99990001', classification: 'T2', amount: 186 })
    expect(rows[2].warnings.join()).toContain('ungewöhnlich')
    expect(rows[3].warnings.join()).toContain('passt nicht')
    expect(rows[3].value).toMatchObject({ slaughter_date: '2026-08-27', category: 'Schaf' })
  })
})
