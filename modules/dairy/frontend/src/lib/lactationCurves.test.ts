import { describe, expect, it } from 'vitest'
import {
  analyzeLactations,
  buildHerdReference,
  buildTestDayModel,
  curveClass,
  curveKey,
  metricValue,
  quartileBounds,
  quartileOf,
  slope,
  type TestPoint,
} from './lactationCurves'

const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)

/** Herde: Kurve 2.4 kg am Anfang, −0.4 kg je 30 Tage. */
function herdTests(): TestPoint[] {
  const out: TestPoint[] = []
  for (let a = 0; a < 10; a++) {
    for (let k = 0; k < 7; k++) {
      out.push({
        animal_id: `h${a}`,
        lactation_number: 2,
        calving_date: '2025-01-01',
        test_date: addDays('2025-01-01', 15 + k * 30),
        milk_kg: 2.4 - 0.3 * k,
        fat_pct: 6,
        protein_pct: 5,
      })
    }
  }
  return out
}

describe('lactationCurves', () => {
  it('rechnet F+E aus Milch und Gehalten', () => {
    expect(metricValue({ milk_kg: 2, fat_pct: 6, protein_pct: 5 }, 'fe')).toBeCloseTo(0.22)
    expect(metricValue({ milk_kg: 2, fat_pct: null, protein_pct: 5 }, 'fe')).toBeNull()
  })

  it('Herdenkurve je 30-Tage-Abschnitt; leere Abschnitte vom Nachbarn', () => {
    const ref = buildHerdReference(herdTests(), 'milk')
    expect(ref.groups[2][0].median).toBeCloseTo(2.4)
    expect(ref.groups[2][3].median).toBeCloseTo(1.5)
    expect(ref.groups[2][9].borrowed).toBe(true)
  })

  it('Niveau und Persistenz relativ zur Herde', () => {
    const tests = herdTests()
    // gleichmässig 20 % über der Herde → Niveau 1.2, Persistenz 0
    const steady = tests.filter((t) => t.animal_id === 'h0').map((t) => ({ ...t, animal_id: 'x', milk_kg: t.milk_kg * 1.2 }))
    // startet 30 % über der Herde, fällt auf 70 % → fällt ab
    const falling = tests
      .filter((t) => t.animal_id === 'h0')
      .map((t, k) => ({ ...t, animal_id: 'y', milk_kg: t.milk_kg * (1.3 - k * 0.1) }))
    const all = [...tests, ...steady, ...falling]
    const curves = analyzeLactations(all, buildTestDayModel(all, 'milk'))
    const x = curves.get(curveKey('x', 2))!
    const y = curves.get(curveKey('y', 2))!
    expect(x.level).toBeCloseTo(1.2, 1)
    expect(Math.abs(x.persistence!)).toBeLessThan(0.02)
    expect(curveClass(x)).toBe('hoch_ausdauernd')
    expect(y.persistence!).toBeLessThan(-0.3)
    expect(curveClass(y)).toBe('hoch_abfallend')
  })

  it('Testtag-Effekt fällt weg (schwaches Jahr, alle gleichzeitig)', () => {
    const good = herdTests() // 2025
    const weak = herdTests().map((t) => ({
      ...t,
      animal_id: `w${t.animal_id}`,
      calving_date: '2026-01-01',
      test_date: t.test_date.replace(/^2025/, '2026'),
      milk_kg: t.milk_kg * 0.7,
    }))
    const curves = analyzeLactations([...good, ...weak], buildTestDayModel([...good, ...weak], 'milk'))
    // ein Tier, das genau wie sein (schwacher) Jahrgang melkt, liegt bei 100 %
    expect(curves.get(curveKey('wh0', 2))!.level).toBeCloseTo(1)
    expect(curves.get(curveKey('h0', 2))!.level).toBeCloseTo(1)
    expect(Math.abs(curves.get(curveKey('wh0', 2))!.persistence!)).toBeLessThan(0.01)
  })

  it('erste Wägungen weglassen: zählen nicht, bleiben sichtbar', () => {
    const tests = herdTests()
    // erste Wägung (Säugezeit) sehr tief, danach wie die Herde
    const x = tests.filter((t) => t.animal_id === 'h0').map((t, k) => ({ ...t, animal_id: 'x', milk_kg: k === 0 ? t.milk_kg * 0.3 : t.milk_kg }))
    const all = [...tests, ...x]
    const model = buildTestDayModel(all, 'milk')
    const withFirst = analyzeLactations(all, model, 0).get(curveKey('x', 2))!
    const skipped = analyzeLactations(all, model, 1).get(curveKey('x', 2))!
    expect(withFirst.level!).toBeLessThan(0.95)
    expect(skipped.level).toBeCloseTo(1)
    expect(skipped.points[0].excluded).toBe(true)
    expect(skipped.points).toHaveLength(7)
  })

  it('Viertel und Steigung', () => {
    const b = quartileBounds([0.8, 0.9, 1.0, 1.1, 1.2])!
    expect(quartileOf(1.2, b)).toBe(4)
    expect(quartileOf(0.8, b)).toBe(1)
    expect(slope([0, 100], [1, 0.9])).toBeCloseTo(-0.001)
  })
})

describe('Testtag-Modell', () => {
  it('Sommereinbruch trifft alle gleichzeitig — keine Abwertung der Persistenz', () => {
    // Tiere mit unterschiedlichem Geburtsdatum; ab Juli melkt die ganze Herde 40 % weniger
    const tests: TestPoint[] = []
    for (let a = 0; a < 12; a++) {
      const calving = addDays('2026-01-01', a * 10)
      for (let k = 0; k < 8; k++) {
        const test_date = addDays('2026-02-15', k * 30)
        const dim = Math.round((Date.parse(test_date) - Date.parse(calving)) / 86_400_000)
        if (dim < 0) continue
        const summer = test_date >= '2026-07-01' ? 0.6 : 1
        tests.push({ animal_id: `a${a}`, lactation_number: 2, calving_date: calving, test_date, milk_kg: (2.5 - dim / 150) * summer, fat_pct: 6, protein_pct: 5 })
      }
    }
    const curves = analyzeLactations(tests, buildTestDayModel(tests, 'milk'))
    // ohne Testtag-Faktor wären es rund −0.4 (Sommereinbruch als "fällt ab")
    for (const c of curves.values()) expect(Math.abs(c.persistence ?? 0)).toBeLessThan(0.2)
  })
})
