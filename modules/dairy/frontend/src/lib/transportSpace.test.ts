import { describe, expect, it } from 'vitest'
import { lambKgByAge, spaceFor, transportSummary, type TransportAnimal } from './transportSpace'

const cow = (id: string, kg: number | null, basis: TransportAnimal['basis'] = 'waage'): TransportAnimal => ({ id, species: 'cattle', liveKg: kg, basis })
const sheep = (id: string, kg: number | null, extra: Partial<TransportAnimal> = {}): TransportAnimal => ({ id, species: 'sheep', liveKg: kg, basis: 'waage', ...extra })

describe('spaceFor (TSchV Anhang 4)', () => {
  it('Rindvieh nach Gewicht, Grenzen gehören zur oberen Klasse', () => {
    expect(spaceFor(cow('a', 60))).toMatchObject({ m2: 0.3, addCm: 20 })
    expect(spaceFor(cow('a', 150))).toMatchObject({ m2: 0.8, addCm: 25, band: '150–250 kg' })
    expect(spaceFor(cow('a', 649))).toMatchObject({ m2: 1.6, addCm: 35 })
    expect(spaceFor(cow('a', 720))).toMatchObject({ m2: 1.8, band: 'über 700 kg' })
  })
  it('Schafe ungeschoren, geschoren, Widder und hochträchtig', () => {
    expect(spaceFor(sheep('a', 25))).toMatchObject({ m2: 0.2, addCm: 20, band: 'unter 30 kg' })
    expect(spaceFor(sheep('a', 50))).toMatchObject({ m2: 0.4 })
    expect(spaceFor(sheep('a', 50), { shorn: true })).toMatchObject({ m2: 0.33 })
    expect(spaceFor(sheep('a', 70), { shorn: true })).toMatchObject({ m2: 0.4 })
    expect(spaceFor(sheep('a', 55), { pregnantLate: true })).toMatchObject({ m2: 0.5, band: 'Aue hochträchtig' })
    expect(spaceFor(sheep('a', null, { breedingRam: true }))).toMatchObject({ m2: 0.5, band: 'Zuchtwidder' })
  })
  it('ohne Gewicht nichts', () => {
    expect(spaceFor(cow('a', null))).toBeNull()
  })
})

describe('transportSummary', () => {
  it('summiert Flächen, grösster Zuschlag, Klassen sortiert, geschätzte und fehlende Gewichte', () => {
    const s = transportSummary([cow('a', 600), cow('b', 610, 'schaetzung'), cow('c', 120), cow('d', null, 'annahme')])
    expect(s.m2).toBe(3.6)
    expect(s.addCm).toBe(35)
    expect(s.bands).toEqual([
      { band: '80–150 kg', m2: 0.4, n: 1 },
      { band: '550–700 kg', m2: 1.6, n: 2 },
    ])
    expect(s).toMatchObject({ animals: 4, counted: 3, estimated: 1, unknown: 1 })
  })
})

it('Lamm nach Alter', () => {
  expect(lambKgByAge(0)).toBe(5)
  expect(lambKgByAge(100)).toBe(30)
  expect(lambKgByAge(1000)).toBe(65)
})
