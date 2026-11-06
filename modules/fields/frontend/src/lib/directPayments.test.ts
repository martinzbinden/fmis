import { describe, expect, it } from 'vitest'
import { basisAbstufung, classifyDp, compareWithStatement, dpCropName, DP_DEFAULTS, DP_STORED_EMPTY, hangFromStatement, q2FromStatement, referenceFor, resolveSettings, tierRate, vernetzungRates, DP_RATES, estimateFarm, steillagenAnsatz, type DpFarmEstimate, type DpLineKey, type DpParcel } from './directPayments'

const rates = DP_RATES[2026]

let nextId = 0
const parcel = (kultur_code: string, kultur_name_de: string | null, ha: number, zone: string | null = '51', baeume: number | null = null): DpParcel => {
  nextId += 1
  return { id: `d${nextId}`, lineage_id: `l${nextId}`, flurname: null, kultur_code, kultur_name_de, area_a: ha * 100, baeume, zone }
}
const sum = (e: DpFarmEstimate, key: DpLineKey) => e.lines.find((l) => l.key === key)?.amount ?? 0

describe('kleine Weide (10.61 a, Bergzone I)', () => {
  const weide = parcel('616', 'Weiden', 0.1061)

  it('rechnet Offenhaltung, Basis und Erschwernis, keinen Hangbeitrag', () => {
    const p = estimateFarm(rates, [weide], DP_DEFAULTS).parcels[0]
    expect(p.lines.map((l) => [l.key, Math.round(l.amount * 100) / 100])).toEqual([
      ['offenhaltung', 24.4],
      ['basis', 63.66],
      ['erschwernis', 54.11],
    ])
    expect(p.total).toBeCloseTo(142.17, 2)
    expect(p.hangPossible).toBe(false)
  })

  it('zählt Bio und GMF nur, wenn angegeben', () => {
    const p = estimateFarm(rates, [weide], { ...DP_DEFAULTS, bio: true, gmf: true }).parcels[0]
    expect(p.total).toBeCloseTo(184.61, 2)
  })
})

// Sollwerte aus dem Beitragsrechner von AGRIDEA V 4.11, mit denselben Eingaben gerechnet
describe('Gegenrechnung mit dem AGRIDEA-Rechner', () => {
  const ext = parcel('611', 'Extensiv genutzte Wiesen', 4)
  const weideBff = parcel('617', 'Extensiv genutzte Weiden', 3, '53')
  const hecke = parcel('852', 'Hecken', 0.5)
  const obst = parcel('921', 'Hochstammfeldobstbäume', 0, '51', 25)
  const nuss = parcel('922', 'Nussbäume', 0, '51', 5)
  const parcels = [
    parcel('513', 'Winterweizen', 30),
    parcel('601', 'Kunstwiesen (ohne Weiden)', 10),
    ext,
    parcel('612', 'Wenig intensiv genutzte Wiesen', 1),
    parcel('613', 'Übrige Dauerwiesen', 15),
    parcel('851', 'Streueflächen', 1),
    hecke,
    weideBff,
    parcel('616', 'Weiden', 12, '53'),
    obst,
    nuss,
  ]
  const settings = {
    ...DP_DEFAULTS,
    bio: true,
    gmf: true,
    rgve: 20,
    hang: [10, 20, 5] as [number, number, number],
    q2: { [ext.lineage_id]: 400, [weideBff.lineage_id]: 300, [hecke.lineage_id]: 50, [obst.lineage_id]: 25, [nuss.lineage_id]: 5 },
  }

  it('Betrieb mit Abstufung, GMF unter dem Tierbesatz', () => {
    const e = estimateFarm(rates, parcels, settings)
    expect(sum(e, 'offenhaltung')).toBeCloseTo(19730, 6)
    expect(sum(e, 'hang')).toBeCloseTo(23100, 6)
    expect(sum(e, 'steillagen')).toBeCloseTo(3361.34453781513, 6)
    expect(e.rgveMin).toBeCloseTo(18, 6)
    expect(e.factor).toBe(1)
    expect(e.basisHa).toBe(75)
    expect(e.abstufung).toBeCloseTo(72 / 75, 9)
    expect(sum(e, 'basis')).toBeCloseTo(40896, 6)
    expect(sum(e, 'erschwernis')).toBeCloseTo(30600 + 8550, 6)
    expect(sum(e, 'offeneAckerflaeche')).toBeCloseTo(12000, 6)
    expect(sum(e, 'q1')).toBeCloseTo(4745, 6)
    expect(sum(e, 'q2')).toBeCloseTo(11190, 6)
    expect(sum(e, 'bio')).toBeCloseTo(45300, 6)
    expect(e.rgveMinGmf).toBeCloseTo(25, 6)
    expect(e.factorGmf).toBeCloseTo(0.8, 9)
    expect(sum(e, 'gmf')).toBeCloseTo(7200, 6)
  })

  it('Mindesttierbesatz nicht erreicht: Faktor auf Dauergrünland, nicht auf Acker und Kunstwiese', () => {
    const e = estimateFarm(rates, parcels, { ...settings, rgve: 9 })
    expect(e.factor).toBeCloseTo(0.5, 9)
    expect(sum(e, 'basis')).toBeCloseTo(31968, 6)
    expect(sum(e, 'erschwernis')).toBeCloseTo(25500 + 4275, 6)
    expect(e.factorGmf).toBeCloseTo(0.36, 9)
    expect(sum(e, 'gmf')).toBeCloseTo(3240, 6)
  })
})

describe('classifyDp', () => {
  it('nennt Kulturen ohne Beitrag und nicht zugeordnete getrennt', () => {
    expect(classifyDp('901', 'Wald')).toHaveProperty('ohne')
    expect(classifyDp('698', 'übrige Dauergrünfläche (ohne Beitrag)')).toHaveProperty('ohne')
    expect(classifyDp('924', 'Einzelbäume')).toHaveProperty('ohne')
    expect(classifyDp('857', 'Hecken (mit Pufferstreifen)')).toHaveProperty('ohne')
    expect(classifyDp('568', '')).toHaveProperty('offen')
    expect(classifyDp('556', 'Buntbrache')).toHaveProperty('offen')
    expect(classifyDp('660', 'Unbekannt')).toHaveProperty('offen')
  })

  it('Getreide in weiter Reihe zählt als Acker', () => {
    expect(classifyDp('516', 'GiwR Dinkel (BFF)')).toEqual({ kind: 'acker' })
  })

  it('Code 569 hat in den Raumdaten keinen Namen und zählt als Acker', () => {
    expect(classifyDp('569', '')).toEqual({ kind: 'acker' })
    expect(dpCropName('569', '')).toMatch(/Körnerleguminosen/)
  })

  it('«insitu» bleibt dieselbe Nutzung', () => {
    expect(classifyDp('616', 'insitu Weiden')).toEqual({ kind: 'dauergruen' })
  })
})

describe('Regeln am Rand', () => {
  it('Flächenabstufung über die Stufen', () => {
    expect(basisAbstufung(rates, 60)).toBe(1)
    expect(basisAbstufung(rates, 80)).toBeCloseTo(76 / 80, 9)
    expect(basisAbstufung(rates, 200)).toBeCloseTo(100 / 200, 9)
  })

  it('Steillagen linear von 30 bis 100 %', () => {
    expect(steillagenAnsatz(0.29)).toBe(0)
    expect(steillagenAnsatz(0.3)).toBeCloseTo(100, 9)
    expect(steillagenAnsatz(1)).toBe(1000)
  })

  it('unter 50 a Hanglagen kein Hang- und Steillagenbeitrag', () => {
    const e = estimateFarm(rates, [parcel('613', 'Übrige Dauerwiesen', 1)], { ...DP_DEFAULTS, hang: [0, 0.4, 0] })
    expect(e.hangZuKlein).toBe(true)
    expect(sum(e, 'hang')).toBe(0)
    expect(sum(e, 'steillagen')).toBe(0)
  })

  it('Qualitätsstufe II auch für einen Teil der Parzelle, höchstens die ganze', () => {
    const wiese = parcel('611', 'Extensiv genutzte Wiesen', 1)
    const baum = parcel('921', 'Hochstammfeldobstbäume', 0, '51', 25)
    const e = estimateFarm(rates, [wiese, baum], { ...DP_DEFAULTS, q2: { [wiese.lineage_id]: 50, [baum.lineage_id]: 15 } })
    expect(sum(e, 'q2')).toBeCloseTo(0.5 * 1700 + 15 * 31.5, 6)
    const voll = estimateFarm(rates, [wiese], { ...DP_DEFAULTS, q2: { [wiese.lineage_id]: 500 } })
    expect(sum(voll, 'q2')).toBeCloseTo(1700, 6)
  })

  it('ohne gültige Kultur: Basis und Bio, aber nicht offene Ackerfläche und GMF', () => {
    const e = estimateFarm(rates, [parcel('99999', 'Bitte Kultur wählen', 1)], { ...DP_DEFAULTS, bio: true, gmf: true })
    expect(e.parcels[0].lines.map((l) => l.key)).toEqual(['offenhaltung', 'basis', 'erschwernis', 'bio'])
  })

  it('unter 20 Bäumen kein Baumbeitrag', () => {
    const e = estimateFarm(rates, [parcel('921', 'Hochstammfeldobstbäume', 0, '51', 19)], DP_DEFAULTS)
    expect(e.total).toBe(0)
    expect(e.parcels[0].ohne).toMatch(/20 Bäumen/)
  })

  it('Fläche ohne Zone oder Zuordnung bleibt draussen und wird ausgewiesen', () => {
    const e = estimateFarm(rates, [parcel('613', 'Übrige Dauerwiesen', 2, null), parcel('660', 'Unbekannt', 1)], DP_DEFAULTS)
    expect(e.total).toBe(0)
    expect(e.offenHa).toBe(3)
  })
})

// erfundene Abrechnung: im öffentlichen Repo keine echten Zahlen
const line = (section: string, label: string, zone: string | null, quantity: number, rate: number, amount: number) => ({ section, label, zone, quantity, rate, factor: 1, amount })

describe('aus der Abrechnung', () => {
  const lines = [
    line('hang', '18-35%', '51', 200, 4.1, 820),
    line('hang', '18-35%', '52', 100, 4.1, 410),
    line('hang', '35%-50%', '51', 50, 7, 350),
    line('hang', 'über 50%', '51', 10, 10, 100),
    line('q2', 'Extensiv genutzte Wiesen', '51', 100, 17, 1700),
    line('q2', 'Hochstammfeldobstbäume', '51', 10, 31.5, 315),
    line('vernetzung', 'Extensiv genutzte Wiesen', '51', 150, 10, 1500),
    line('vernetzung', 'Hochstammfeldobstbäume', '51', 15, 5, 75),
    line('vernetzung', 'Einzelbäume und Alleen', '51', 2, 5, 10),
    line('vernetzung', 'Getreide in weiter Reihe', '51', 50, 6, 300),
    line('lq', 'Diversitätsbonus', null, 800, 1, 584),
    line('lq', 'Wald-Vorland', '51', 100, 1.55, 113.15),
    line('weide', 'A01 Weidebeitrag', null, 10, 350, 3500.5),
    line('raus', 'A05 weibliche Tiere bis 160 Tage alt', null, 1, 370, 370),
    line('raus', 'D01 Schafe: weibliche Tiere, über ein Jahr', null, 2, 190, 380),
    line('bts', 'A03 weibliche, über 365 Tage', null, 4, 75, 300),
    line('alpung', 'Alpungsbeitrag', null, 3, 370, 1110),
  ]

  it('Hektaren je Hangklasse', () => {
    expect(hangFromStatement(lines)).toEqual([3, 0.5, 0.1])
  })

  it('Vernetzungsansätze je Hektare bzw. Baum', () => {
    expect(vernetzungRates(lines)).toEqual({ ext_wiese: 1000, obstbaum: 5, einzelbaum: 5, giwr: 600 })
  })

  it('Tierwohl-Ansätze nach Anhang 7', () => {
    expect(tierRate('weide', 'A01 Weidebeitrag')).toBe(350)
    expect(tierRate('weide', 'A05 x')).toBe(530)
    expect(tierRate('raus', 'A09 x')).toBe(370)
    expect(tierRate('raus', 'D01 x')).toBe(190)
    expect(tierRate('bts', 'A03 x')).toBe(75)
    expect(tierRate('bts', 'A05 x')).toBeNull()
    expect(tierRate('bts', 'D01 x')).toBeNull()
  })

  it('verteilt Qualitätsstufe II anteilig und höchstens auf die ganze Fläche', () => {
    const a = parcel('611', 'Extensiv genutzte Wiesen', 1.5)
    const b = parcel('611', 'Extensiv genutzte Wiesen', 0.5)
    const baum = parcel('921', 'Hochstammfeldobstbäume', 0, '51', 40)
    const q2 = q2FromStatement([a, b, baum], lines)
    expect(q2[a.lineage_id]).toBeCloseTo(75, 6)
    expect(q2[b.lineage_id]).toBeCloseTo(25, 6)
    expect(q2[baum.lineage_id]).toBeCloseTo(10, 6)
  })

  it('Rechner: Vernetzung nach Abrechnung, neue Flächen ändern die Summe nicht', () => {
    const wiese = parcel('611', 'Extensiv genutzte Wiesen', 2)
    const neu = parcel('611', 'Extensiv genutzte Wiesen', 1)
    const baum = parcel('921', 'Hochstammfeldobstbäume', 0, '51', 30)
    const einzel = parcel('924', 'Einzelbäume', 0, '51', 2)
    const giwr = parcel('516', 'GiwR Dinkel (BFF)', 1)
    const parcels = [wiese, neu, baum, einzel, giwr]
    const ref = referenceFor(lines.map((l) => ({ ...l, farm_id: 'f', jahr: 2025 })), 'f', 2026)!
    expect(ref.jahr).toBe(2025)
    const e = estimateFarm(rates, parcels, resolveSettings(DP_STORED_EMPTY, parcels, ref), ref)
    expect(sum(e, 'vernetzung')).toBeCloseTo(1500 + 75 + 10 + 600, 6)
    expect(e.parcels.find((p) => p.parcel === einzel)?.total).toBeCloseTo(10, 6)
    expect(sum(e, 'lq')).toBeCloseTo(697.15, 6)
    expect(sum(e, 'weide')).toBeCloseTo(3500, 6)
    expect(sum(e, 'raus')).toBeCloseTo(750, 6)
    expect(sum(e, 'bts')).toBeCloseTo(300, 6)
    expect(sum(e, 'hang')).toBeCloseTo(3 * 410 + 0.5 * 700 + 0.1 * 1000, 6)
    const rows = compareWithStatement(e, ref.lines)
    expect(rows.find((r) => r.key === 'weide')).toMatchObject({ statement: 3500.5 })
    expect(rows.find((r) => r.key === 'alpung')).toMatchObject({ calc: null, statement: 1110, label: 'Alpung' })
  })

  it('Gespeichertes geht vor, ohne Abrechnung sind Bio und GMF vorbelegt', () => {
    const wiese = parcel('611', 'Extensiv genutzte Wiesen', 2)
    expect(resolveSettings(DP_STORED_EMPTY, [wiese])).toMatchObject({ bio: true, gmf: true })
    const ref = { jahr: 2025, lines, vernetzung: {} }
    expect(resolveSettings(DP_STORED_EMPTY, [wiese], ref)).toMatchObject({ bio: false, gmf: false })
    const s = resolveSettings({ ...DP_STORED_EMPTY, bio: true, hang: [1, null, null], q2: { [wiese.lineage_id]: 7 } }, [wiese], ref)
    expect(s.bio).toBe(true)
    expect(s.hang).toEqual([1, 0.5, 0.1])
    expect(s.q2[wiese.lineage_id]).toBe(7)
  })
})
