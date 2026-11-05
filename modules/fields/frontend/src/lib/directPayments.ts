// Direktzahlungen: Schätzung je Parzelle und Betrieb nach DZV (SR 910.13), Ansätze
// aus Anhang 7, Stand Verordnungspaket Oktober 2025 (gilt ab 2026). Gegengerechnet
// mit dem Beitragsrechner von AGRIDEA V 4.11 (siehe directPayments.test.ts).
//
// Hier gerechnet: Offenhaltung (Art. 42), Hang (Art. 43) und Steillagen (Art. 44),
// Basis (Art. 50), Produktionserschwernis (Art. 52), offene Ackerfläche und
// Dauerkulturen (Art. 53), Qualitätsbeitrag der Biodiversitätsförderflächen
// (Art. 55–59), Bio (Art. 66) und GMF. Massgebend bleibt die Abrechnung des Kantons.
//
// Die Neigung steht nicht in den Raumdaten: Hang und Steillagen rechnen darum aus den
// Hektaren je Hangklasse, die der Benutzer angibt, und zählen nur beim Betrieb.
// Spezialkulturen auf Codes 500–599 (z.B. Gemüse) zählen beim Bio-Beitrag als Ackerfläche.

import { cropInfo } from './rotationRules'

export type ZoneCode = '31' | '41' | '51' | '52' | '53' | '54'

// Legende BLW, Geodatensatz «Landwirtschaftliche Zonengrenzen» (ch.blw.landwirtschaftliche-zonengrenzen)
export const ZONE_LABEL: Record<ZoneCode, string> = {
  '31': 'Talzone',
  '41': 'Hügelzone',
  '51': 'Bergzone I',
  '52': 'Bergzone II',
  '53': 'Bergzone III',
  '54': 'Bergzone IV',
}

type ByZone = Record<ZoneCode, number>

const byZone = (tz: number, hz: number, bz1: number, bz2: number, bz3: number, bz4: number): ByZone => ({
  '31': tz,
  '41': hz,
  '51': bz1,
  '52': bz2,
  '53': bz3,
  '54': bz4,
})

// Anhang 7; Ziffern in Klammern
const RATES_2026 = {
  offenhaltung: byZone(0, 100, 230, 320, 380, 390), // 1.1.1
  hang: [410, 700, 1000] as const, // 1.2.1
  basis: 600, // 2.1.1
  basisBff: 300, // 2.1.2
  // 2.1.3: Beitragssatz je Flächenstufe (bis 60 ha voll, je 20 ha weiter 20 % weniger, ab 140 ha nichts)
  abstufung: [
    { bisHa: 60, satz: 1 },
    { bisHa: 80, satz: 0.8 },
    { bisHa: 100, satz: 0.6 },
    { bisHa: 120, satz: 0.4 },
    { bisHa: 140, satz: 0.2 },
  ],
  erschwernis: byZone(0, 390, 510, 550, 570, 590), // 2.2.1
  offeneAckerflaeche: 400, // 2.3.1
  // 3.1.1
  q1: {
    ext_wiese: byZone(780, 560, 300, 300, 300, 300),
    wenig_wiese: byZone(300, 300, 300, 300, 300, 300),
    bff_weide: byZone(300, 300, 300, 300, 300, 300),
    uferwiese: byZone(300, 300, 300, 300, 300, 300),
    streue: byZone(1440, 1220, 860, 860, 680, 680),
    hecke: byZone(2160, 2160, 2160, 2160, 2160, 2160),
  },
  q2: {
    ext_wiese: byZone(1920, 1840, 1700, 1700, 1100, 1100),
    wenig_wiese: byZone(1540, 1470, 1360, 1360, 1000, 1000),
    bff_weide: byZone(700, 700, 700, 700, 700, 700),
    streue: byZone(2060, 1980, 1840, 1840, 1770, 1770),
    hecke: byZone(2840, 2840, 2840, 2840, 2840, 2840),
  },
  // 3.1.2, mindestens 20 Bäume je Betrieb (Art. 58)
  baumQ1: { obstbaum: 13.5, nussbaum: 13.5 },
  baumQ2: { obstbaum: 31.5, nussbaum: 16.5 },
  baumMin: 20,
  bio: { spezial: 1600, acker: 1200, uebrige: 200 }, // 5.1.1
  gmf: 200, // 5.11
  // Art. 51 (RGVE/ha), auf Dauergrün-BFF 30 % davon
  tierbesatz: byZone(1, 0.8, 0.7, 0.6, 0.5, 0.4),
  tierbesatzBff: 0.3,
}

export const DP_RATES: Record<number, typeof RATES_2026> = { 2026: RATES_2026 }

type Rates = typeof RATES_2026

export type DpKind =
  | 'acker'
  | 'dauerkultur'
  | 'kunstwiese'
  | 'dauergruen'
  | 'ext_wiese'
  | 'wenig_wiese'
  | 'bff_weide'
  | 'uferwiese'
  | 'streue'
  | 'hecke'
  | 'obstbaum'
  | 'nussbaum'

/** Einordnung einer Kultur: `ohne` gibt sicher nichts, `offen` ist hier nicht zuzuordnen. */
export type DpClass = { kind: DpKind } | { ohne: string } | { offen: string }

const KIND_BY_CODE: Record<string, DpKind> = {
  '611': 'ext_wiese',
  '622': 'ext_wiese',
  '612': 'wenig_wiese',
  '623': 'wenig_wiese',
  '613': 'dauergruen',
  '616': 'dauergruen',
  '697': 'dauergruen',
  '617': 'bff_weide',
  '618': 'bff_weide',
  '634': 'uferwiese',
  '705': 'dauerkultur',
  '851': 'streue',
  '852': 'hecke',
  '921': 'obstbaum',
  '923': 'obstbaum',
  '922': 'nussbaum',
}

const OHNE_BEITRAG: Record<string, string> = {
  '698': 'Dauergrünfläche ohne Beitrag',
  '901': 'Wald',
  '902': 'unproduktive Fläche',
  '924': 'Einzelbäume und Alleen: kein Qualitätsbeitrag mehr, nur Vernetzung',
}

// Dauerweiden (Art. 43 Abs. 2) bekommen keinen Hangbeitrag, Hecken ebenso
const OHNE_HANG = new Set(['616', '617', '618', '852'])

export function classifyDp(code: string, name: string | null): DpClass {
  if (code === '99999' || !name?.trim()) return { offen: 'Kultur fehlt in den Raumdaten' }
  if (OHNE_BEITRAG[code]) return { ohne: OHNE_BEITRAG[code] }
  if (code === '857') return { offen: 'Hecke mit Pufferstreifen: Beitrag laut Merkblatt 6.2 prüfen' }
  if (KIND_BY_CODE[code]) return { kind: KIND_BY_CODE[code] }
  const info = cropInfo(code, name)
  if (info.kunstwiese) return { kind: 'kunstwiese' }
  if (info.open) {
    // Brachen, Säume und Streifen haben eigene Regeln, Fasernutzung keinen Basisbeitrag
    if (/brache|saum|streifen|hanf|kenaf|chinaschilf/i.test(name)) return { offen: 'Für diese Kultur sind keine Ansätze hinterlegt' }
    return { kind: 'acker' }
  }
  return { offen: `Code ${code} ist nicht hinterlegt` }
}

export interface DpParcel {
  id: string
  lineage_id: string
  flurname: string | null
  kultur_code: string
  kultur_name_de: string | null
  area_a: number | null
  baeume: number | null
  zone: string | null
}

export interface DpSettings {
  bio: boolean
  gmf: boolean
  /** RGVE effektiv; ohne Angabe gilt der Mindesttierbesatz als erreicht */
  rgve: number | null
  /** Hektaren je Hangklasse: 18–35 %, >35–50 %, >50 % */
  hang: [number, number, number]
  /** Parzellen-Linien mit Qualitätsstufe II */
  q2: string[]
}

export const DP_DEFAULTS: DpSettings = { bio: false, gmf: false, rgve: null, hang: [0, 0, 0], q2: [] }

export type DpLineKey = 'offenhaltung' | 'basis' | 'erschwernis' | 'offeneAckerflaeche' | 'q1' | 'q2' | 'bio' | 'gmf' | 'hang' | 'steillagen'

export const DP_LINE_LABEL: Record<DpLineKey, string> = {
  offenhaltung: 'Offenhaltung',
  basis: 'Basisbeitrag',
  erschwernis: 'Produktionserschwernis',
  offeneAckerflaeche: 'Offene Ackerfläche, Dauerkulturen',
  q1: 'Biodiversität Qualitätsstufe I',
  q2: 'Biodiversität Qualitätsstufe II',
  bio: 'Biologische Landwirtschaft',
  gmf: 'Graslandbasierte Produktion (GMF)',
  hang: 'Hangbeitrag',
  steillagen: 'Steillagenbeitrag',
}

export interface DpLine {
  key: DpLineKey
  /** Ansatz nach Kürzungen, Fr./ha bzw. Fr./Baum */
  rate: number
  amount: number
}

export interface DpParcelEstimate {
  parcel: DpParcel
  ha: number
  zoneLabel: string | null
  lines: DpLine[]
  total: number
  /** Grund, wenn nichts berechnet ist */
  ohne?: string
  offen?: string
  /** Qualitätsstufe II möglich */
  q2Possible: boolean
  q2: boolean
  /** Fläche kann Hangbeitrag auslösen (je nach Neigung) */
  hangPossible: boolean
  isTree: boolean
}

export interface DpFarmEstimate {
  parcels: DpParcelEstimate[]
  lines: DpLine[]
  total: number
  /** beitragsberechtigte Fläche in dieser Schätzung */
  lnHa: number
  /** Fläche ohne Zuordnung, nicht in der Schätzung */
  offenHa: number
  basisHa: number
  /** Anteil des Basisbeitrags nach Flächenabstufung */
  abstufung: number
  rgveMin: number
  /** Faktor auf Dauergrünland (Mindesttierbesatz), 1 = erreicht */
  factor: number
  rgveMinGmf: number
  factorGmf: number
  steillagenAnteil: number
  /** Unter 50 a Hanglagen gibt es keinen Hangbeitrag (Art. 43 Abs. 3) */
  hangZuKlein: boolean
}

const BFF_GRUEN = new Set<DpKind>(['ext_wiese', 'wenig_wiese', 'bff_weide', 'uferwiese'])

/** Anteil des vollen Basisbeitrags bei dieser Fläche (Anhang 7 Ziff. 2.1.3, gewichtet über die Stufen). */
export function basisAbstufung(rates: Rates, ha: number): number {
  if (ha <= 0) return 1
  let weighted = 0
  let from = 0
  for (const { bisHa, satz } of rates.abstufung) {
    weighted += Math.max(0, Math.min(ha, bisHa) - from) * satz
    from = bisHa
  }
  return weighted / ha
}

/** Steillagenbeitrag: linear von 100 Fr./ha bei 30 % bis 1000 Fr./ha bei 100 % Anteil (Ziff. 1.3.1). */
export function steillagenAnsatz(anteil: number): number {
  if (anteil < 0.3) return 0
  if (anteil >= 1) return 1000
  return 100 + ((anteil - 0.3) * 100 * 900) / 70
}

const isZone = (z: string | null): z is ZoneCode => z != null && z in ZONE_LABEL

export function estimateFarm(rates: Rates, parcels: DpParcel[], settings: DpSettings): DpFarmEstimate {
  const q2Set = new Set(settings.q2)
  const rows = parcels.map((parcel) => ({ parcel, ha: (parcel.area_a ?? 0) / 100, cls: classifyDp(parcel.kultur_code, parcel.kultur_name_de) }))

  // Betriebsgrössen vorab: Mindesttierbesatz, Flächenabstufung, Baumzahl
  let rgveMin = 0
  let rgveMinGmf = 0
  let basisHa = 0
  let trees = 0
  for (const { parcel, ha, cls } of rows) {
    if (!('kind' in cls)) continue
    if (cls.kind === 'obstbaum' || cls.kind === 'nussbaum') {
      trees += parcel.baeume ?? 0
      continue
    }
    if (!isZone(parcel.zone)) continue
    const besatz = rates.tierbesatz[parcel.zone]
    if (BFF_GRUEN.has(cls.kind)) {
      rgveMin += ha * besatz * rates.tierbesatzBff
      rgveMinGmf += ha * besatz * rates.tierbesatzBff
    } else if (cls.kind === 'dauergruen') {
      rgveMin += ha * besatz
      rgveMinGmf += ha * besatz
    } else if (cls.kind === 'kunstwiese') {
      rgveMinGmf += ha * besatz
    }
    if (cls.kind !== 'streue' && cls.kind !== 'hecke') basisHa += ha
  }
  const factorOf = (min: number) => (settings.rgve == null || min <= 0 ? 1 : Math.min(1, settings.rgve / min))
  const factor = factorOf(rgveMin)
  const factorGmf = factorOf(rgveMinGmf)
  const abstufung = basisAbstufung(rates, basisHa)
  const treesOk = trees >= rates.baumMin

  let lnHa = 0
  let offenHa = 0
  const estimates = rows.map(({ parcel, ha, cls }): DpParcelEstimate => {
    const zoneLabel = isZone(parcel.zone) ? ZONE_LABEL[parcel.zone] : null
    const base = { parcel, ha, zoneLabel, lines: [] as DpLine[], total: 0, q2Possible: false, q2: false, hangPossible: false, isTree: false }
    if ('ohne' in cls) return { ...base, ohne: cls.ohne }
    if ('offen' in cls) {
      offenHa += ha
      return { ...base, offen: cls.offen }
    }
    const { kind } = cls
    const lines: DpLine[] = []
    const add = (key: DpLineKey, rate: number, amount: number) => {
      if (rate > 0) lines.push({ key, rate, amount })
    }

    if (kind === 'obstbaum' || kind === 'nussbaum') {
      const n = parcel.baeume ?? 0
      const q2 = q2Set.has(parcel.lineage_id)
      if (treesOk) {
        add('q1', rates.baumQ1[kind], rates.baumQ1[kind] * n)
        if (q2) add('q2', rates.baumQ2[kind], rates.baumQ2[kind] * n)
      }
      const total = lines.reduce((s, l) => s + l.amount, 0)
      return { ...base, lines, total, q2Possible: treesOk, q2: q2 && treesOk, isTree: true, ohne: treesOk ? undefined : `Erst ab ${rates.baumMin} Bäumen im Betrieb` }
    }
    if (!isZone(parcel.zone)) {
      offenHa += ha
      return { ...base, offen: 'Zone der Bewirtschaftungseinheit fehlt' }
    }
    const zone = parcel.zone
    lnHa += ha
    const perHa = (key: DpLineKey, rate: number) => add(key, rate, rate * ha)

    if (kind !== 'hecke') perHa('offenhaltung', rates.offenhaltung[zone])
    if (kind !== 'streue' && kind !== 'hecke') {
      const bff = BFF_GRUEN.has(kind)
      const gruen = bff || kind === 'dauergruen'
      const f = gruen ? factor : 1
      perHa('basis', (bff ? rates.basisBff : rates.basis) * f * abstufung)
      perHa('erschwernis', rates.erschwernis[zone] * f)
    }
    if (kind === 'acker' || kind === 'dauerkultur') perHa('offeneAckerflaeche', rates.offeneAckerflaeche)

    const q2Rates = rates.q2 as Partial<Record<DpKind, ByZone>>
    const q1Rates = rates.q1 as Partial<Record<DpKind, ByZone>>
    const q2Possible = q2Rates[kind] != null
    const q2 = q2Possible && q2Set.has(parcel.lineage_id)
    if (q1Rates[kind]) perHa('q1', q1Rates[kind][zone])
    if (q2) perHa('q2', q2Rates[kind]![zone])

    if (settings.bio) perHa('bio', kind === 'dauerkultur' ? rates.bio.spezial : kind === 'acker' ? rates.bio.acker : rates.bio.uebrige)
    if (settings.gmf && (BFF_GRUEN.has(kind) || kind === 'dauergruen' || kind === 'kunstwiese')) perHa('gmf', rates.gmf * factorGmf)

    const hangPossible = !OHNE_HANG.has(parcel.kultur_code) && kind !== 'dauerkultur'
    return { ...base, lines, total: lines.reduce((s, l) => s + l.amount, 0), q2Possible, q2, hangPossible }
  })

  // Summen je Beitrag; Hang und Steillagen nur beim Betrieb
  const sums = new Map<DpLineKey, number>()
  for (const e of estimates) for (const l of e.lines) sums.set(l.key, (sums.get(l.key) ?? 0) + l.amount)
  const hangHa = settings.hang[0] + settings.hang[1] + settings.hang[2]
  const hangZuKlein = hangHa > 0 && hangHa < 0.5
  if (hangHa >= 0.5) sums.set('hang', settings.hang[0] * rates.hang[0] + settings.hang[1] * rates.hang[1] + settings.hang[2] * rates.hang[2])
  const steilHa = hangZuKlein ? 0 : settings.hang[1] + settings.hang[2]
  const steillagenAnteil = lnHa > 0 ? steilHa / lnHa : 0
  const steilRate = steillagenAnsatz(steillagenAnteil)
  if (steilRate > 0) sums.set('steillagen', steilRate * steilHa)

  const order = Object.keys(DP_LINE_LABEL) as DpLineKey[]
  const lines = order.filter((k) => sums.has(k)).map((key) => ({ key, rate: 0, amount: sums.get(key)! }))
  return {
    parcels: estimates,
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    lnHa,
    offenHa,
    basisHa,
    abstufung,
    rgveMin,
    factor,
    rgveMinGmf,
    factorGmf,
    steillagenAnteil,
    hangZuKlein,
  }
}
