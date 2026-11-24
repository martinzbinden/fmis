import { describe, expect, it } from 'vitest'
import { breedMature, calibrate, cattleBoundary, cattleCategory, cattlePrice, cattleValue, carcassYield, chtaxLabel, FALLBACK_CATTLE_PRICES, girthToLiveKg, modelLiveKg, type CattleInput } from './carcassValue'

const base: CattleInput = { birthDate: '2024-01-01', sex: 'w', calved: false, breed: 'HO', sireBreed: null, damBreed: null, weights: [], chtax: [] }

describe('Kategorie', () => {
  it('nach Alter, Geschlecht und Abkalbung', () => {
    expect(cattleCategory('w', 200, false)).toBe('KV')
    expect(cattleCategory('m', 500, false)).toBe('MT')
    expect(cattleCategory('m', 700, false)).toBe('MA')
    expect(cattleCategory('k', 500, false)).toBe('OB')
    expect(cattleCategory('k', 900, false)).toBe('VK')
    expect(cattleCategory('w', 600, false)).toBe('RG')
    expect(cattleCategory('w', 600, true)).toBe('VK')
    expect(cattleCategory('w', 950, false)).toBe('VK')
  })
})

describe('Preis', () => {
  it('T3 ohne Abzüge, Fettklasse und Kälberalter ziehen ab', () => {
    expect(cattlePrice('VK', 'T', 3, 2000, FALLBACK_CATTLE_PRICES)?.perKg).toBe(10)
    expect(cattlePrice('VK', 'A', 1, 2000, FALLBACK_CATTLE_PRICES)?.perKg).toBe(8.7)
    expect(cattlePrice('KV', 'T', 3, 200, FALLBACK_CATTLE_PRICES)?.perKg).toBe(17.6)
  })
  it('Rinder A–X zum Kuhpreis, fehlende Wochenpreise aus der Ersatztabelle', () => {
    const p = cattlePrice('RG', 'X', 3, 600, {})
    expect(p?.base).toBe(8.45)
    expect(p?.fallback).toBe(true)
  })
  it('Ausbeute aus LG/SG der Zeile, Kälber fest', () => {
    expect(carcassYield('VK', 'T', FALLBACK_CATTLE_PRICES)).toBe(0.48)
    expect(carcassYield('KV', 'T', FALLBACK_CATTLE_PRICES)).toBe(0.58)
  })
  it('CH-TAX-Beschriftung', () => {
    expect(chtaxLabel('T', 3)).toBe('T3')
    expect(chtaxLabel('+', 2)).toBe('+T2')
    expect(chtaxLabel('-', 4)).toBe('−T4')
  })
})

describe('Gewicht', () => {
  it('Kurve wächst und hat eine Obergrenze', () => {
    expect(modelLiveKg(365, 650, 'w')).toBeGreaterThan(modelLiveKg(180, 650, 'w'))
    expect(modelLiveKg(4000, 650, 'w')).toBe(650)
    expect(modelLiveKg(500, 650, 'm')).toBeGreaterThan(modelLiveKg(500, 650, 'w'))
  })
  it('Rasse aus Vater und Mutter', () => {
    expect(breedMature('HO', 'LM', 'HO').kg).toBe(725)
    expect(breedMature(null, null, null).basis).toBe('Rasse unbekannt')
  })
  it('Messband nach Brustumfang', () => {
    expect(girthToLiveKg(180)).toBe(456)
    expect(girthToLiveKg(20)).toBeNull()
  })
})

describe('Schlachtwert', () => {
  it('ohne eigene Angaben: Kurve und T3', () => {
    const v = cattleValue(base, '2027-01-01', FALLBACK_CATTLE_PRICES)!
    expect(v.category).toBe('VK')
    expect(v.fleshiness).toBe('T')
    expect(v.chtaxBasis).toBe('Annahme T3')
    expect(v.weightBasis).toContain('Rasse HO')
    expect(v.gross).toBeCloseTo(v.kg * 10, 5)
  })
  it('die jüngste eigene Schätzung zählt, auch die Taxierung', () => {
    const v = cattleValue(
      {
        ...base,
        weights: [
          { date: '2026-06-01', method: 'auge', carcassKg: 280 },
          { date: '2026-12-01', method: 'messband', liveKg: 600 },
        ],
        chtax: [
          { date: '2026-05-01', fleshiness: 'H', fat: 3 },
          { date: '2026-12-01', fleshiness: 'A', fat: 2 },
        ],
      },
      '2026-12-01',
      FALLBACK_CATTLE_PRICES,
    )!
    expect(v.weightBasis).toBe('Messband 01.12.2026')
    expect(v.kg).toBe(276)
    expect(v.fleshiness).toBe('A')
    expect(v.pricePerKg).toBe(9)
  })
  it('Abzüge und Betriebsfaktor', () => {
    const v = cattleValue({ ...base, weights: [{ date: '2026-12-01', method: 'auge', carcassKg: 300 }] }, '2026-12-01', FALLBACK_CATTLE_PRICES, { slaughterDate: '', feePerAnimal: 20, transportPerAnimal: 30, priceFactor: 0.9 })!
    expect(v.gross).toBe(2700)
    expect(v.net).toBe(2650)
  })
  it('Abrechnungen passen die Kurve an', () => {
    const cal = calibrate([
      { carcassKg: 300, ageDays: 2000, sex: 'w', calved: true, mature: 650 },
      { carcassKg: 280, ageDays: 2500, sex: 'w', calved: true, mature: 650 },
    ])
    expect(cal.adult?.n).toBe(2)
    expect(cal.adult?.factor).toBeCloseTo(0.93, 2)
    const v = cattleValue({ ...base, breed: null }, '2030-01-01', FALLBACK_CATTLE_PRICES, undefined, cal)!
    expect(v.weightBasis).toContain('Abrechnungen ×0.93 (2)')
  })
})

describe('Preisgrenze', () => {
  const heifer: CattleInput = { ...base, birthDate: '2024-01-01', weights: [{ date: '2026-05-01', method: 'auge', carcassKg: 300 }] }
  it('Rind mit 900 Tagen: Kuh-Preis, Mindererlös bei gleichem Gewicht', () => {
    // 901 Tage alt am 2026-06-20
    const b = cattleBoundary(heifer, '2026-06-01', FALLBACK_CATTLE_PRICES)!
    expect(b.date).toBe('2026-06-20')
    expect(b.days).toBe(19)
    expect(b.to).toBe('VK')
    expect(b.loss).toBeGreaterThan(300)
    expect(b.text).toContain('Kuh-Preis')
  })
  it('erwartete Abkalbung vor 900 Tagen zählt zuerst', () => {
    const b = cattleBoundary({ ...heifer, expectedCalving: '2026-06-10' }, '2026-06-01', FALLBACK_CATTLE_PRICES)!
    expect(b.reason).toBe('abkalbung')
    expect(b.date).toBe('2026-06-10')
  })
  it('weit weg oder schon Kuh: kein Hinweis; Schlachttermin verlängert den Blick', () => {
    expect(cattleBoundary(heifer, '2026-01-01', FALLBACK_CATTLE_PRICES)).toBeNull()
    expect(cattleBoundary({ ...heifer, calved: true }, '2026-06-01', FALLBACK_CATTLE_PRICES)).toBeNull()
    expect(cattleBoundary(heifer, '2026-01-01', FALLBACK_CATTLE_PRICES, { slaughterDate: '2026-07-01', feePerAnimal: 0, transportPerAnimal: 0, priceFactor: 1 })?.days).toBe(170)
  })
  it('Muni mit 600 Tagen', () => {
    const b = cattleBoundary({ ...base, sex: 'm', breed: 'LM' }, '2025-08-10', FALLBACK_CATTLE_PRICES)!
    expect(b.from).toBe('MT')
    expect(b.to).toBe('MA')
    expect(b.text).toContain('Muni über 600 Tage')
  })
})
