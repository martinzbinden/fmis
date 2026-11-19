import { describe, expect, it } from 'vitest'
import { DEFAULT_LAMB_VALUE, herdMeanLactationKg, lambValue } from './lambValue'

const s = { heritability: 0.3, repeatability: 0.45, sirePctPerPoint: 1, lactations: 4 }

describe('lambValue', () => {
  it('Mutter 20 % über dem Mittel mit 3 Laktationen, Vater 110: Erbanteil und Franken', () => {
    // b = 3·0.3 / (1 + 2·0.45) = 0.4737 → Mutter ½·0.4737·20 = 4.74 %, Vater ½·10 = 5 %
    const v = lambValue({ damRel: 1.2, damLactations: 3, sireValue: 110 }, s, 400, 3)!
    expect(v.damPart).toBe(4.7)
    expect(v.sirePart).toBe(5)
    expect(v.pct).toBe(9.7)
    expect(v.kgPerLactation).toBe(38.9)
    expect(v.francs).toBe(467) // 38.9 kg × 4 × 3 Fr.
  })
  it('fehlender Elternteil zählt als Mittel', () => {
    const v = lambValue({ damRel: null, damLactations: 0, sireValue: 90 }, s, 400, 3)!
    expect(v.damPart).toBeNull()
    expect(v.pct).toBe(-5)
    expect(v.francs).toBe(-240)
  })
  it('Erstling ohne abgeschlossene Laktation zählt wie eine Laktation', () => {
    expect(lambValue({ damRel: 1.2, damLactations: 0, sireValue: null }, s, 400, 3)!.damPart).toBe(3)
  })
  it('eine Laktation der Mutter zählt weniger als mehrere', () => {
    const one = lambValue({ damRel: 1.2, damLactations: 1, sireValue: null }, s, 400, 3)!
    const four = lambValue({ damRel: 1.2, damLactations: 4, sireValue: null }, s, 400, 3)!
    expect(one.damPart).toBe(3) // ½·0.3·20
    expect(four.damPart!).toBeGreaterThan(one.damPart!)
  })
  it('ohne Eltern-Information oder Herdenmittel keine Schätzung', () => {
    expect(lambValue({ damRel: null, damLactations: 0, sireValue: null }, s, 400, 3)).toBeNull()
    expect(lambValue({ damRel: 1.1, damLactations: 2, sireValue: 100 }, s, null, 3)).toBeNull()
  })
  it('Vorgaben je Tierart', () => {
    expect(DEFAULT_LAMB_VALUE.cattle.lactations).toBe(3)
  })
})

describe('herdMeanLactationKg', () => {
  const l = (kg: number, days: number, date: string) => ({ milk_kg: kg, days_in_milk: days, calving_date: date })
  it('nur Laktationen ab 100 Tagen der letzten 4 Jahre, mindestens 5', () => {
    const rows = [l(300, 200, '2025-02-01'), l(400, 220, '2024-02-01'), l(500, 210, '2023-02-01'), l(350, 180, '2025-03-01'), l(450, 150, '2024-03-01'), l(50, 40, '2025-02-01'), l(900, 250, '2019-02-01')]
    expect(herdMeanLactationKg(rows, '2026-01-15')).toBe(400)
    expect(herdMeanLactationKg(rows.slice(0, 4), '2026-01-15')).toBeNull()
  })
})
