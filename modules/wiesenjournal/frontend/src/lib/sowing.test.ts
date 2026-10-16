import { describe, expect, it } from 'vitest'
import {
  EMPTY_SOWING,
  kgPerHaFromSeeds,
  plantsM2,
  recalc,
  seedsFromKgPerHa,
  seedsPerRowMeter,
  sowingSummary,
  totalKg,
  totalSeedsM2,
} from './sowing'

describe('Saat-Umrechnung', () => {
  it('Saatmenge aus Saatstärke, TKG und Keimfähigkeit', () => {
    // 350 keimfähige Kö/m² × 45 g / 95 % = 165.8 kg/ha
    expect(kgPerHaFromSeeds(350, 45, 95)).toBe(165.8)
    // ohne Keimfähigkeit = 100 %
    expect(kgPerHaFromSeeds(350, 45, null)).toBe(157.5)
  })

  it('Saatstärke aus Saatmenge (Umkehrung)', () => {
    expect(seedsFromKgPerHa(165.8, 45, 95)).toBe(350)
    expect(seedsFromKgPerHa(160, 40, null)).toBe(400)
  })

  it('Pflanzen erwartet aus Feldaufgang', () => {
    expect(plantsM2(350, 80)).toBe(280)
    expect(plantsM2(350, null)).toBeNull()
  })

  it('Körner je Reihenmeter, auch mit weiter Reihe', () => {
    // 400 Kö/m² auf 12.5 cm: 50 Kö/m Reihe
    expect(seedsPerRowMeter(400, 12.5, null)).toBe(50)
    // jede 3. Reihe zu → nur 2/3 der Reihen gesät → 75 Kö/m
    expect(seedsPerRowMeter(400, 12.5, 3)).toBe(75)
    expect(totalSeedsM2(380, 95)).toBe(400)
  })

  it('Gesamtmenge für die Parzelle', () => {
    expect(totalKg(160, 250)).toBe(400)
  })
})

describe('recalc', () => {
  const base = { ...EMPTY_SOWING, tkg: '45', germination: '95' }

  it('Körner geändert → kg/ha', () => {
    expect(recalc({ ...base, seeds: '350' }, 'seeds').kgHa).toBe('165.8')
  })

  it('kg/ha geändert → Körner', () => {
    expect(recalc({ ...base, kgHa: '165,8' }, 'kgHa').seeds).toBe('350')
  })

  it('TKG geändert → kg/ha aus Körnern, sonst Körner aus kg/ha', () => {
    expect(recalc({ ...base, tkg: '50', seeds: '350' }, 'tkg').kgHa).toBe('184.2')
    expect(recalc({ ...base, tkg: '50', kgHa: '190' }, 'tkg').seeds).toBe('361')
  })

  it('ohne TKG (Mischung) bleibt alles wie eingegeben', () => {
    const f = { ...EMPTY_SOWING, kgHa: '30', seeds: '' }
    expect(recalc(f, 'kgHa')).toBe(f)
  })
})

describe('sowingSummary', () => {
  it('fasst Pflanzen, Reihenmeter und Gesamtmenge zusammen', () => {
    const s = sowingSummary({ ...EMPTY_SOWING, tkg: '45', germination: '100', seeds: '400', kgHa: '180', emergence: '85', rowSpacing: '12.5', wideRowEvery: '4' }, 120)
    expect(s.plants).toBe(340)
    expect(s.perRowMeter).toBe(67)
    expect(s.sownRowsPct).toBe(75)
    expect(s.totalKg).toBe(216)
  })
})
