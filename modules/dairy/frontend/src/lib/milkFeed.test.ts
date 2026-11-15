import { describe, expect, it } from 'vitest'
import { DEFAULT_MILK_FEED, fmtMilkFeed, milkFeed, milkFeedPoints, type MilkFeedInput, type MilkFeedSettings } from './milkFeed'

const S: MilkFeedSettings = { ...DEFAULT_MILK_FEED.sheep, declinePerMonth: 0, minDailyKg: 0.1 }
const base: MilkFeedInput = { species: 'sheep', today: '2026-11-15', sample: null, lastBirth: '2026-11-01', dry: false, expectedBirth: null, pregnancy: null }

describe('milkFeed', () => {
  it('ohne Belegung: Annahme Belegung in 30 Tagen + 150 Tage Tragzeit', () => {
    const m = milkFeed({ ...base, sample: { date: '2026-11-15', kg: 0.5, perMilking: true } }, S)
    expect(m.birthBasis).toBe('annahme')
    expect(m.birth).toBe('2027-05-14') // 15.11. + 180 Tage
    expect(m.feedDays).toBe(180)
    expect(m.dailyKg).toBe(1) // 0.5 × 2 Melkungen
    // ohne Rückgang: bis 60 Tage vor der Geburt = 120 Tage à 1 kg
    expect(m.milkDays).toBe(120)
    expect(m.milkKg).toBe(120)
    expect(m.milkValue).toBe(300)
    expect(m.feedCost).toBeCloseTo(180 * 1.5 + 120 * 0.25, 5)
    expect(m.balance).toBeCloseTo(300 - 300, 5)
  })

  it('gemeldete Belegung bestimmt die Geburt; leer danach = Annahme', () => {
    const mated = milkFeed({ ...base, expectedBirth: '2027-03-01' }, S)
    expect(mated.birthBasis).toBe('belegung')
    expect(mated.birth).toBe('2027-03-01')
    const empty = milkFeed({ ...base, expectedBirth: '2027-03-01', pregnancy: { result: 'nein', date: '2026-11-10', examiner: null, method: null, weeks: null } }, S)
    expect(empty.birthBasis).toBe('annahme')
  })

  it('trächtig mit Wochen ohne Belegung: Rest der Tragzeit ab der Untersuchung', () => {
    const m = milkFeed({ ...base, pregnancy: { result: 'ja', date: '2026-11-15', examiner: null, method: 'ultraschall', weeks: 10 } }, S)
    expect(m.birthBasis).toBe('untersuchung')
    expect(m.birth).toBe('2027-02-03') // 150 − 70 = 80 Tage
  })

  it('Rückgang und Mindestmenge beenden das Melken früher', () => {
    const s = { ...S, declinePerMonth: 50, minDailyKg: 0.5 }
    const m = milkFeed({ ...base, sample: { date: '2026-11-15', kg: 1, perMilking: false } }, s)
    // 1 kg halbiert sich je 30 Tage: Tag 30 genau 0.5 zählt noch, ab Tag 31 darunter
    expect(m.milkDays).toBe(31)
    expect(m.milkUntil).toBe('2026-12-15')
  })

  it('trocken: keine Milch, nur Futter (negative Bilanz)', () => {
    const m = milkFeed({ ...base, dry: true, expectedBirth: '2027-01-14' }, S)
    expect(m.milkKg).toBe(0)
    expect(m.dailyKg).toBe(0)
    expect(m.balance).toBeCloseTo(-60 * 1.5, 5)
  })

  it('Wägung aus der alten Laktation oder zu alt zählt nicht: Bilanz unbekannt', () => {
    expect(milkFeed({ ...base, sample: { date: '2026-10-01', kg: 1, perMilking: false } }, S).balance).toBeNull()
    expect(milkFeed({ ...base, lastBirth: null, sample: { date: '2026-08-01', kg: 1, perMilking: false } }, S).balance).toBeNull()
    expect(fmtMilkFeed(milkFeed(base, S))).toContain('keine aktuelle Wägung')
  })

  it('Punkte für den Vorschlag: Verlust nach oben (max. +3), Gewinn nach unten (max. −2)', () => {
    expect(milkFeedPoints(-270, 100)).toBe(3)
    expect(milkFeedPoints(-160, 100)).toBe(2)
    expect(milkFeedPoints(-20, 100)).toBe(0)
    expect(milkFeedPoints(160, 100)).toBe(-2)
    expect(milkFeedPoints(900, 100)).toBe(-2)
    expect(milkFeedPoints(-500, 100)).toBe(3)
    expect(milkFeedPoints(null, 100)).toBe(0)
    expect(milkFeedPoints(-500, 0)).toBe(0)
  })

  it('Geburt überfällig: ab heute, kein Melken mehr', () => {
    const m = milkFeed({ ...base, expectedBirth: '2026-11-01', sample: { date: '2026-11-15', kg: 1, perMilking: false } }, S)
    expect(m.birth).toBe('2026-11-15')
    expect(m.milkDays).toBe(0)
    expect(m.feedDays).toBe(0)
  })
})
