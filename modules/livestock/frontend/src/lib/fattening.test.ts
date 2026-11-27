import { describe, expect, it } from 'vitest'
import {
  buildCurve,
  bySire,
  DEFAULT_FATTENING_SETTINGS,
  evaluateLamb,
  fatteningStart,
  histogram,
  nevPerDay,
  normalizeSettings,
  settingsDiffer,
  slopeOn,
  summarize,
  weightOn,
  dayNo,
  type LambInput,
} from './fattening'

// Nur erfundene Werte (Ohrmarken CH9999…)
const lamb = (p: Partial<LambInput>): LambInput => ({
  id: Math.random().toString(36),
  ear_tag: 'CH99990001',
  animal_key: 'CH99990001',
  slaughter_date: '2026-07-21',
  carcass_kg: 13.8,
  classification: 'T3',
  price_per_kg: 12,
  amount: 180,
  buyer: 'Schlachtbetrieb',
  settlement_no: '100001',
  birth_date: '2026-04-01',
  sex: 'm',
  birth_weight_kg: null,
  weights: [],
  livestock_id: null,
  entry_date: null,
  entry_weight_kg: null,
  purchase_cost: null,
  allocated_group_cost: null,
  medication_cost: null,
  group_name: null,
  wean_date: null,
  wean_reason: null,
  sire: null,
  dam: null,
  ...p,
})

const S = DEFAULT_FATTENING_SETTINGS

describe('Energiebedarf NEV aus dem Grünen Buch', () => {
  it('an den Stützstellen genau die Tabellenwerte', () => {
    expect(nevPerDay('m', 'hoch', 30, 250)).toEqual({ nev: 6.6, outside: false })
    expect(nevPerDay('w', 'gering', 15, 150)).toEqual({ nev: 4.7, outside: false })
    expect(nevPerDay('m', 'gering', 35, 400).nev).toBeCloseTo(11.4, 10)
    expect(nevPerDay('w', 'hoch', 40, 400).nev).toBeCloseTo(9.9, 10)
    // Kastrat und unbekannt: männliche Tabelle
    expect(nevPerDay('k', 'hoch', 25, 200).nev).toBeCloseTo(5.4, 10)
    expect(nevPerDay(null, 'hoch', 25, 200).nev).toBeCloseTo(5.4, 10)
  })

  it('zwischen den Stützstellen bilinear', () => {
    // 25 kg: (5.4 + 5.6) / 2 = 5.5; 30 kg: (6.3 + 6.6) / 2 = 6.45; Mitte 5.975
    const r = nevPerDay('m', 'hoch', 27.5, 225)
    expect(r.nev).toBeCloseTo(5.975, 10)
    expect(r.outside).toBe(false)
  })

  it('ausserhalb linear fortgeschrieben und gekennzeichnet', () => {
    // 15 kg ist unter der Tabelle (ab 20 kg): 4.6 − 5 × 0.16 = 3.8
    const low = nevPerDay('m', 'hoch', 15, 200)
    expect(low.nev).toBeCloseTo(3.8, 10)
    expect(low.outside).toBe(true)
    // 600 g → auf 500 g begrenzt: 9.8 + 0.2 = 10.0
    const fast = nevPerDay('m', 'hoch', 40, 600)
    expect(fast.nev).toBeCloseTo(10.0, 10)
    expect(fast.outside).toBe(true)
    // Weiblich, gering, 15 kg mit 300 g: Block 15 kg reicht nur bis 250 g
    expect(nevPerDay('w', 'gering', 15, 300).outside).toBe(true)
    expect(nevPerDay('m', 'gering', 5, 0).nev).toBeGreaterThanOrEqual(0)
  })
})

describe('Gewichtskurve', () => {
  it('stückweise linear, unplausible Punkte fallen weg', () => {
    const c = buildCurve(
      [
        { date: '2026-04-01', kg: 4 },
        { date: '2026-04-11', kg: 8 },
        { date: '2026-04-11', kg: 10 },
        { date: '2026-03-01', kg: 3 },
        { date: '2026-05-01', kg: 0 },
        { date: '2026-08-01', kg: 40 },
      ],
      '2026-04-01',
      '2026-07-01',
    )
    expect(c.points.map((p) => p.kg)).toEqual([4, 9])
    expect(weightOn(c, dayNo('2026-04-06'))).toBeCloseTo(6.5, 10)
    expect(weightOn(c, dayNo('2026-04-12'))).toBeNull()
    expect(slopeOn(c, dayNo('2026-04-11'))).toBeCloseTo(0.5, 10)
  })
})

describe('Mastbeginn', () => {
  it('Mastplaner vor Absetzen vor angenommenem Absetzalter', () => {
    const base = { birth_date: '2026-04-01', wean_date: '2026-05-20', wean_reason: 'abgesetzt' as const, entry_date: '2026-06-01' }
    expect(fatteningStart(base, S)).toEqual({ date: '2026-06-01', source: 'Mastplaner' })
    expect(fatteningStart({ ...base, entry_date: null }, S)).toEqual({ date: '2026-05-20', source: 'Absetzen' })
    expect(fatteningStart({ ...base, entry_date: null, wean_reason: 'weggenommen' }, S)?.source).toBe('weggenommen')
    expect(fatteningStart({ ...base, entry_date: null, wean_date: null }, S)).toEqual({ date: '2026-05-11', source: 'angenommen' })
    expect(fatteningStart({ birth_date: null, entry_date: null, wean_date: null, wean_reason: null }, S)).toBeNull()
  })
})

describe('Kennzahlen je Lamm', () => {
  // Geburt 1.4. (4.5 kg angenommen), Einstallung 1.6. mit 20 kg, am Schlachttag 21.7. gewogen 30 kg: 50 Masttage à 200 g
  const fed = lamb({
    livestock_id: 'a1',
    entry_date: '2026-06-01',
    entry_weight_kg: 20,
    purchase_cost: 0,
    weights: [{ date: '2026-07-21', kg: 30 }],
    allocated_group_cost: 25,
    medication_cost: 5,
  })

  it('Tageszunahmen, Lebendgewicht, Ausbeute', () => {
    const r = evaluateLamb(fed, S)
    expect(r.ageDays).toBe(111)
    expect(r.lwKg).toBe(30)
    expect(r.lwWeighed).toBe(true)
    expect(r.dressingMeasuredPct).toBe(46)
    expect(r.ltz).toBe(230) // (30 − 4.5) / 111
    expect(r.ntz).toBe(124) // 13.8 / 111
    expect(r.mtz).toBe(200) // (30 − 20) / 50
    expect(r.startSource).toBe('Mastplaner')
    expect(r.fatteningDays).toBe(50)
  })

  it('TS und NEV über die Masttage (von Hand nachgerechnet)', () => {
    const r = evaluateLamb(fed, S)
    // TS = 0.04 × Σ (20 + 0.2 i), i = 0…49 = 0.04 × 1245 = 49.8
    expect(r.dmKg).toBe(49.8)
    // NEV bis 25 kg: Σ (4.6 + 0.032 i), i = 0…25 = 130.0; danach Σ (4.5 + 0.036 i), i = 26…49 = 140.4
    expect(r.nevMj).toBe(270)
    expect(r.fcr).toBe(4.98)
    expect(r.energyDensity).toBe(5.43)
    expect(r.outsideShare).toBe(0)
  })

  it('Deckungsbeitrag mit erfassten und mit geschätzten Futterkosten', () => {
    const r = evaluateLamb(fed, S)
    expect(r.feedCostSource).toBe('erfasst')
    expect(r.feedCost).toBe(25)
    expect(r.totalCost).toBe(33.72)
    expect(r.margin).toBe(146.28)
    expect(r.marginPerDay).toBe(2.93)
    expect(r.marginPerKgGain).toBe(14.63)

    const est = evaluateLamb({ ...fed, allocated_group_cost: 0 }, S)
    expect(est.feedCostSource).toBe('geschätzt')
    expect(est.feedCost).toBe(14.94) // 49.8 kg TS × 0.30
    expect(est.margin).toBe(156.34)

    // Erlös aus SG × Preis, Wert bei Mastbeginn aus dem Einstallgewicht
    const noAmount = evaluateLamb({ ...fed, amount: null }, { ...S, startValuePerKg: 5 })
    expect(noAmount.revenue).toBe(165.6)
    expect(noAmount.startValue).toBe(100)
  })

  it('ohne gemessenes Gewicht bei Mastbeginn keine MTZ, Futter aus der Kurve', () => {
    const r = evaluateLamb(lamb({ wean_date: '2026-05-11', wean_reason: 'abgesetzt' }), S)
    expect(r.lwWeighed).toBe(false)
    expect(r.lwKg).toBe(30) // 13.8 / 0.46
    expect(r.startSource).toBe('Absetzen')
    expect(r.startWeightMeasured).toBe(false)
    expect(r.startWeightKg).toBe(13.7) // 4.5 + 25.5 × 40 / 111
    expect(r.mtz).toBeNull()
    expect(r.dmKg).not.toBeNull()
    expect(r.dressingMeasuredPct).toBeNull()
  })

  it('fehlende Angaben bleiben leer', () => {
    const r = evaluateLamb(lamb({ birth_date: null }), S)
    expect(r.ageDays).toBeNull()
    expect(r.ltz).toBeNull()
    expect(r.ntz).toBeNull()
    expect(r.startDate).toBeNull()
    expect(r.dmKg).toBeNull()
    expect(r.feedCost).toBeNull()
    expect(r.margin).toBeNull()

    const noKg = evaluateLamb(lamb({ carcass_kg: null, amount: null }), S)
    expect(noKg.lwKg).toBeNull()
    expect(noKg.ntz).toBeNull()
    expect(noKg.revenue).toBeNull()
    expect(noKg.margin).toBeNull()
  })
})

describe('Zusammenfassung und Gruppen', () => {
  it('Mittel nur über vorhandene Werte, Futterverwertung über alle Tiere', () => {
    const rows = [
      lamb({ livestock_id: 'a1', entry_date: '2026-06-01', entry_weight_kg: 20, weights: [{ date: '2026-07-21', kg: 30 }], sire: 'Widder A' }),
      lamb({ ear_tag: 'CH99990002', animal_key: 'CH99990002', sire: 'Widder A' }),
      lamb({ ear_tag: 'CH99990003', animal_key: 'CH99990003', birth_date: null, sire: 'Widder B' }),
    ].map((l) => evaluateLamb(l, S))
    const s = summarize(rows)
    expect(s.n).toBe(3)
    expect(s.nNoBirth).toBe(1)
    expect(s.meanAge).toBe(111)
    expect(s.nMtz).toBe(1)
    expect(s.meanMtz).toBe(200)
    expect(s.nDm).toBe(2)
    expect(s.nMargin).toBe(2)
    expect(bySire(rows).map((g) => [g.key, g.summary.n])).toEqual([['Widder A', 2]])
  })

  it('Histogramm in Klassen à 50 g, lückenlos', () => {
    expect(histogram([210, 230, 340, null])).toEqual([
      { from: 200, to: 250, n: 2 },
      { from: 250, to: 300, n: 0 },
      { from: 300, to: 350, n: 1 },
    ])
    expect(histogram([])).toEqual([])
  })

  it('Einstellungen: Vorgaben für Fehlendes und Ungültiges', () => {
    expect(normalizeSettings(null)).toEqual(S)
    expect(normalizeSettings({ dressingPct: '48', growthPotential: 'gering', feedCostPerKgDm: -1 })).toEqual({ ...S, dressingPct: 48, growthPotential: 'gering' })
  })
})

describe('settingsDiffer', () => {
  it('erkennt eigene Annahmen', () => {
    expect(settingsDiffer({ ...DEFAULT_FATTENING_SETTINGS })).toBe(false)
    expect(settingsDiffer({ ...DEFAULT_FATTENING_SETTINGS, dressingPct: 48 })).toBe(true)
    expect(settingsDiffer({ ...DEFAULT_FATTENING_SETTINGS, growthPotential: 'gering' })).toBe(true)
  })
})
