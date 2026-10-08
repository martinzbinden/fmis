import { describe, expect, it } from 'vitest'
import { cellDate, normalizeEarTag, parseCownect, parseWithdrawal, releaseDate, stableUuid, suggestTemplates, withdrawalUntil } from './treatments'
import { treatmentRows } from './treatmentData'
import type { AnimalJournalEntry } from '../types'

const HEADER = [
  'Diagnosedatum', 'Letzte Behandlung', 'Nr.', 'Tiername', 'TVD', 'OS, Position', 'Befunde', 'beh. Pers.', 'Herkunft', 'Startdatum Medi',
  'Handelsname', 'Menge in Basiseinheit', 'Menge in Ausb.einheiten', 'Anzahl Appl.', 'Kritische Antibiotika', 'Medi-Einsatzinfo', 'Antibiogramm',
  'Absetzfrist Milch / Fleisch / Organe / Injektionsst.', 'Freigabe Milch', 'Freigabe Fleisch', 'Freigabe Organe', 'Freigabe Injektionsst.', 'Behandlungsinfo',
]
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe('Absetzfristen', () => {
  it('Freigabe = letzte Anwendung + Frist × Faktor + 1', () => {
    expect(releaseDate('2026-10-07', 1)).toBe('2026-10-09')
    expect(releaseDate('2026-04-21', 3, 2)).toBe('2026-04-28')
    expect(releaseDate('2026-10-07', 0)).toBeNull()
    expect(releaseDate('2026-10-07', null)).toBeNull()
  })
  it('letzter Tag der Frist: gespeicherte Freigabe hat Vorrang, sonst ab letzter Anwendung', () => {
    const j = { entry_date: '2026-10-01', last_date: '2026-10-03', withdrawal_milk_days: 2, withdrawal_meat_days: 4, withdrawal_factor: 2, release_milk_date: null, release_meat_date: '2026-10-20' }
    expect(withdrawalUntil(j, 'milk')).toBe('2026-10-07')
    expect(withdrawalUntil(j, 'meat')).toBe('2026-10-19')
    expect(withdrawalUntil({ ...j, last_date: null, withdrawal_factor: null }, 'milk')).toBe('2026-10-03')
    expect(withdrawalUntil({ ...j, withdrawal_milk_days: 0 }, 'milk')).toBeNull()
  })
  it('cownect-Frist "2x (3 / 4 / 4 / 7)"', () => {
    expect(parseWithdrawal('2x (3 / 4 / 4 / 7)')).toEqual({ factor: 2, milk: 3, meat: 7 })
    expect(parseWithdrawal('0 / 1 / 1 / 1')).toEqual({ factor: 1, milk: 0, meat: 1 })
    expect(parseWithdrawal('')).toBeNull()
  })
})

describe('Hilfen', () => {
  it('Ohrmarke und Datum', () => {
    expect(normalizeEarTag('CH 120.1234.5678.9')).toBe('CH120123456789')
    expect(cellDate(local(2026, 10, 7))).toBe('2026-10-07')
    expect(cellDate('09.10.26')).toBe('2026-10-09')
    expect(cellDate(' - ')).toBeNull()
  })
  it('stabile UUID', () => {
    expect(stableUuid('a')).toBe(stableUuid('a'))
    expect(stableUuid('a')).not.toBe(stableUuid('b'))
    expect(stableUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('parseCownect', () => {
  const rows = [
    HEADER,
    [local(2026, 4, 19), local(2026, 4, 21), '', 'BLUME', 'CH 120.1234.5678.9', 'Euter', 'Mastitis', 'Hans Muster', 'Tierarztpraxis X', local(2026, 4, 19),
      'Euterinjektor A ad us. vet.', '30.0 g', '3.0 Stk.', 3.0, 'Nein', '', 'Ja', '2x (3 / 3 / 3 / 3)', '28.04.26', '27.04.26', '27.04.26', '29.04.26', ''],
    [local(2026, 4, 19), local(2026, 4, 19), '', 'BLUME', 'CH 120.1234.5678.9', 'Euter', 'Mastitis', 'Hans Muster', 'Tierarztpraxis X', local(2026, 4, 19),
      'Schmerzmittel B', '10.0 ml', '10.0 ml', 1.0, 'Nein', 'Fieber 40', 'Nein', '0 / 1 / 1 / 1', ' - ', '21.04.26', '21.04.26', '21.04.26', 'Kontrolle in 2 Tagen'],
    [null, null, null, null, null],
  ]
  const { items, skipped } = parseCownect(rows)
  it('je Präparat eine Zeile, gleicher Fall', () => {
    expect(items).toHaveLength(2)
    expect(skipped).toBe(0)
    expect(items[0].case_key).toBe(items[1].case_key)
    expect(items[0].import_key).not.toBe(items[1].import_key)
  })
  it('Felder', () => {
    const [a, b] = items
    expect(a).toMatchObject({
      ear_tag: 'CH120123456789',
      animal_name: 'BLUME',
      entry_date: '2026-04-19',
      last_date: '2026-04-21',
      dose: '3 Stk. (30 g)',
      applications: 3,
      withdrawal_factor: 2,
      withdrawal_milk_days: 3,
      withdrawal_meat_days: 3,
      release_milk_date: '2026-04-28',
      release_meat_date: '2026-04-29',
      antibiogram: true,
      critical_antibiotic: false,
      supplier: 'Tierarztpraxis X',
    })
    expect(b).toMatchObject({ last_date: null, dose: '10 ml', release_milk_date: null, info: 'Fieber 40 · Kontrolle in 2 Tagen' })
  })
  it('falsche Datei', () => {
    expect(() => parseCownect([['A', 'B']])).toThrow(/cownect/)
  })
})

describe('Behandlung speichern', () => {
  it('je Tier × Präparat, Freigabe gerechnet, Fall-ID je Tier', () => {
    let n = 0
    const rows = treatmentRows(
      {
        animalIds: ['k1', 'k2'],
        date: '2026-10-08',
        time: '18:00',
        body_system: null,
        diagnosis: 'Fieber',
        items: [
          { medication: 'Präparat A', dose: '1 Beutel', applications: 3, days: 3, milk_days: 0, meat_days: 1 },
          { medication: 'Präparat B', dose: '5 ml', applications: 1, days: 1, milk_days: 2, meat_days: 4 },
        ],
        administered_by: 'Hans',
        supplier: 'Tierarztpraxis X',
        factor: 2,
        notes: null,
      },
      () => `id${++n}`,
    )
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ animal_id: 'k1', last_date: '2026-10-10', release_milk_date: null, release_meat_date: '2026-10-13', treatment_time: '18:00' })
    expect(rows[1]).toMatchObject({ last_date: null, release_milk_date: '2026-10-13', release_meat_date: '2026-10-17' })
    expect(rows[0].case_id).toBe(rows[1].case_id)
    expect(rows[2].case_id).not.toBe(rows[0].case_id)
  })
})

describe('suggestTemplates', () => {
  const e = (id: string, caseId: string, date: string, diagnosis: string, medication: string, extra: Partial<AnimalJournalEntry> = {}) =>
    ({ id, case_id: caseId, entry_date: date, diagnosis, medication, category: 'behandlung', dose: '1 ml', applications: 1, last_date: null,
      withdrawal_milk_days: 0, withdrawal_meat_days: 1, deleted_at: null, body_system: null, supplier: null, ...extra }) as AnimalJournalEntry
  it('häufige Fälle; Enthornen ohne Schmerzmittel bekommt NSAID-Platzhalter', () => {
    const s = suggestTemplates([
      e('1', 'a', '2025-01-01', 'Enthornen', 'Xylasin 2% ad us. vet.'),
      e('2', 'a', '2025-01-01', 'Enthornen', 'Lidocain 2% ad us. vet.'),
      e('3', 'b', '2026-02-01', 'Enthornen', 'Lidocain 2% ad us. vet.', { dose: '10 ml' }),
      e('4', 'b', '2026-02-01', 'Enthornen', 'Xylasin 2% ad us. vet.'),
      e('5', 'c', '2026-03-01', 'Impfung; Blauzungenimpfung', 'Impfstoff', { last_date: '2026-03-22' }),
      e('6', 'd', '2026-03-01', 'Impfung; Blauzungenimpfung', 'Impfstoff'),
      e('7', 'e', '2026-03-01', 'Einmalig', 'Etwas'),
    ])
    expect(s.map((x) => x.title)).toEqual(['Blauzungenimpfung', 'Enthornen'])
    const dehorn = s[1]
    expect(dehorn.items.map((i) => i.medication)).toEqual(['Lidocain 2% ad us. vet.', 'Xylasin 2% ad us. vet.', ''])
    expect(dehorn.items[0].dose).toBe('10 ml')
    expect(dehorn.items[2].hint).toMatch(/NSAID/)
  })
})
