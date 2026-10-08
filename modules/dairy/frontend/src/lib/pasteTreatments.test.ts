import { describe, expect, it } from 'vitest'
import { checkTreatments, type TreatmentValue } from './pasteTreatments'

const animals = [
  { id: 'a1', ear_tag: 'CH120123456789', name: 'BLUME', lauf_nr: '12' },
  { id: 'a2', ear_tag: 'CH120123450000', name: 'ROSE', lauf_nr: null },
  { id: 'a3', ear_tag: 'CH120123451111', name: 'ROSE', lauf_nr: null },
]
const existing = [
  // cownect-Import derselben Behandlung
  { id: 'e1', animal_id: 'a1', ear_tag: 'CH120123456789', entry_date: '2026-04-19', category: 'behandlung', diagnosis: 'Mastitis', medication: 'Injektor A ad us. vet.', dose: '3 Stk.', source: 'import', import_key: 'cownect|x' },
]
const base = { datum: '2026-04-20', indikation: 'Fieber', praeparat: 'Mittel B', menge: '10 ml', frist_milch: 0, frist_fleisch: 1, behandelt_durch: 'Hans' }

describe('checkTreatments', () => {
  const rows = checkTreatments(
    [
      { ...base, ohrmarke: 'CH 120.1234.5678.9' }, // neu
      { ...base, ohrmarke: 'CH 120.1234.5678.9' }, // doppelt im Text
      { ohrmarke: 'CH120123456789', datum: '19.04.2026', indikation: 'Mastitis', praeparat: 'Injektor A', menge: '3.0 Stk.', frist_milch: 3, frist_fleisch: 3, behandelt_durch: 'Hans' }, // schon aus cownect
      { ohrmarke: 'CH120123456789', datum: '2026-04-19', indikation: 'Mastitis', praeparat: 'Injektor A', menge: '1 Stk.', frist_milch: 3, frist_fleisch: 3 }, // ähnlich
      { ...base, tier: 'ROSE' }, // mehrdeutig
      { ...base, ohrmarke: 'CH 999.0000.0000.1', tiername: 'KALB' }, // nicht in der Herde
      { ...base, tier: '12', datum: '2099-01-01' }, // Zukunft
      { ...base, tier: 'BLUME', praeparat: '' }, // Präparat fehlt
      { tier: 'BLUME', datum: '2026-05-01', kategorie: 'krankheit', indikation: 'Lahmheit' }, // Krankheit ohne Präparat
      { ...base, tier: 'BLUME', datum: '2026-05-02', frist_milch: undefined, faktor: 2, freigabe_fleisch: '2026-05-03', farbe: 'rot' },
    ],
    animals,
    existing,
    '2026-05-10',
  )
  it('Status', () => {
    expect(rows.map((r) => r.status)).toEqual(['neu', 'aehnlich', 'doppelt', 'aehnlich', 'fehler', 'neu', 'fehler', 'fehler', 'neu', 'neu'])
  })
  it('Gründe und Hinweise', () => {
    expect(rows[1].problems[0]).toMatch(/Datensatz 1/)
    expect(rows[2].problems[0]).toMatch(/bereits im Journal \(Import/)
    expect(rows[3].problems[0]).toMatch(/ähnlicher Eintrag/)
    expect(rows[4].problems[0]).toMatch(/mehrere Tiere/)
    expect(rows[5].info?.[0]).toMatch(/nicht in der Herde/)
    expect((rows[1].value as TreatmentValue).import_key).toBe(`${(rows[0].value as TreatmentValue).import_key}#2`)
    expect(rows[6].problems).toContain('Datum liegt in der Zukunft')
    expect(rows[7].problems[0]).toMatch(/Präparat fehlt/)
    const w = rows[9].warnings.join(' | ')
    expect(w).toMatch(/unbekannte Felder ignoriert: farbe/)
    expect(w).toMatch(/Absetzfrist Milch\/Fleisch fehlt/)
    expect(w).toMatch(/Freigabe Fleisch 3\.5\.2026 früher/)
  })
  it('Werte', () => {
    const v = rows[0].value as TreatmentValue
    expect(v).toMatchObject({ animal_id: 'a1', ear_tag: 'CH120123456789', entry_date: '2026-04-20', release_meat_date: '2026-04-22', release_milk_date: null, withdrawal_factor: 1 })
    const k = rows[5].value as TreatmentValue
    expect(k).toMatchObject({ animal_id: null, ear_tag: 'CH999000000001', animal_name: 'KALB' })
    const s = rows[8].value as TreatmentValue
    expect(s).toMatchObject({ category: 'krankheit', medication: null, withdrawal_factor: null })
    expect((rows[9].value as TreatmentValue).release_meat_date).toBe('2026-05-03')
  })
})
