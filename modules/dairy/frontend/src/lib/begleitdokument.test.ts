import { describe, expect, it } from 'vitest'
import { bdProblems, formEarTag, healthSummary, monthYear, tagList, type BdAnimal, type BdData } from './begleitdokument'

const animal = (p: Partial<BdAnimal> = {}): BdAnimal => ({ id: 'a1', ear_tag: 'CH120012345678', lauf_nr: null, name: null, birth_date: '2023-04-12', sex: 'w', pregnant: null, pregnancyNeeded: false, sick: [], withdrawal: null, ...p })
const data = (p: Partial<BdData> = {}): BdData => ({
  species: 'cattle', date: '2026-11-26', holder: { tvd: '1234567', name: 'Muster Hans', address: 'Testweg 1', place: '9999 Testdorf' },
  destination: 'Schlachthof Beispiel', purpose: 'schlachtung', diseaseFree: true, animals: [animal()], place: 'Testdorf', signer: 'Hans Muster', ...p,
})

describe('Begleitdokument', () => {
  it('Ohrmarke passt ins Kästchenfeld, sonst ohne Ländercode', () => {
    expect(formEarTag('CH 120.0123.4567.8', 15)).toBe('CH120012345678')
    expect(formEarTag('CH 120.0123.4567.8', 12)).toBe('120012345678')
    expect(formEarTag('CH9999.0012', 12)).toBe('CH99990012')
  })

  it('Geburtsdatum als Monat/Jahr', () => {
    expect(monthYear('2023-04-12')).toEqual({ m: '04', y: '2023' })
    expect(monthYear(null)).toEqual({ m: '', y: '' })
  })

  it('Punkt 5: gesund ohne Absetzfrist, sonst betroffene Tiere mit Krankheit und Medikament', () => {
    expect(healthSummary([animal()])).toMatchObject({ healthy: true, noWithdrawal: true, affected: [] })
    const h = healthSummary([animal(), animal({ id: 'a2', sick: ['Lahmheit'], withdrawal: { until: '2026-12-01', medication: 'Testmittel', date: '2026-11-20' } })])
    expect(h).toMatchObject({ healthy: false, noWithdrawal: false, illness: 'Lahmheit', medication: 'Testmittel', treatDate: '20.11.2026' })
    expect(h.affected.map((a) => a.id)).toEqual(['a2'])
  })

  it('Pflichtangaben', () => {
    expect(bdProblems(data())).toEqual([])
    expect(bdProblems(data({ holder: { tvd: '12', name: '', address: '', place: '' }, purpose: null, destination: '' }))).toHaveLength(4)
    expect(bdProblems(data({ animals: [animal({ pregnancyNeeded: true })] }))).toEqual(['Trächtigkeit ja/nein angeben (1 Tier).'])
  })

  it('Nummern zum Einfügen ins Agate-Portal, eine je Zeile', () => {
    expect(tagList({ animals: [{ id: 'a', ear_tag: 'CH 120.0123.4567.8' }, { id: 'b', ear_tag: 'CH99990012' }] })).toBe('CH120012345678\nCH99990012')
  })
})
