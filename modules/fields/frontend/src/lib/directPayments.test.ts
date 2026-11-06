import { describe, expect, it } from 'vitest'
import { basisAbstufung, classifyDp, dpCropName, DP_DEFAULTS, DP_RATES, estimateFarm, steillagenAnsatz, type DpFarmEstimate, type DpLineKey, type DpParcel } from './directPayments'

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
