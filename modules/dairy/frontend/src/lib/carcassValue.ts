// Schlachtwert Rindvieh (Kälber, Rinder, Muni, Ochsen, Kühe): geschätztes Schlachtgewicht (SG) × Proviande-Wochenpreis
// nach CH-TAX. Reine Rechenfunktionen; Daten holt lib/carcassData.ts, die Tierseite und das Dashboard zeigen das Ergebnis.
//
// Schlachtgewicht, in dieser Reihenfolge:
//  1. eigene Schätzung oder Wägung, die jüngste zählt (Waage = Lebendgewicht, Messband = Brustumfang → Lebendgewicht,
//     Auge = Lebend- oder Schlachtgewicht), bis zum Schlachttermin mit der Wachstumskurve fortgeschrieben;
//  2. sonst die Wachstumskurve nach Alter, Geschlecht und Rasse (Vater und Mutter, sonst Rasse des Tiers), angepasst an
//     die früheren Schlachtabrechnungen des Betriebs (Verhältnis tatsächliches SG zu Kurve).
// Lebendgewicht → SG mit der Ausbeute (A%) der Proviande-Tabelle (Preis LG / Preis SG derselben Zeile).
//
// Preis: Kategorie nach Alter, Geschlecht und Abkalbung (KV, MT, MA, OB, RG, VK), Fleischigkeit und Fettklasse aus der
// jüngsten eigenen CH-TAX-Schätzung, sonst T3. Abzüge Fettklasse und Kälber-Alter nach der Proviande-Tabelle (Stand
// Woche 48/2026, ändern selten). Nicht berücksichtigt: Gewichtszuschläge/-abzüge (MT, OB, RG), Kühe unter 450 kg LG,
// Fleischfarbe.

import type { MeatValue } from './meatValue'

export type Fleshiness = 'C' | 'H' | '+' | 'T' | '-' | 'A' | 'X'
export const FLESHINESS: Fleshiness[] = ['C', 'H', '+', 'T', '-', 'A', 'X']
export type FatClass = 1 | 2 | 3 | 4 | 5
export const FAT_CLASSES: FatClass[] = [1, 2, 3, 4, 5]

/** CH-TAX-Kategorien Rindvieh (Proviande) */
export type CattleCategory = 'KV' | 'MT' | 'MA' | 'OB' | 'RG' | 'VK'
export const CATEGORY_LABEL: Record<CattleCategory, string> = {
  KV: 'Kalb (bis 240 Tage)',
  MT: 'Muni (241–600 Tage)',
  MA: 'Muni (über 600 Tage)',
  OB: 'Ochse',
  RG: 'Rind (241–900 Tage, nicht gekalbt)',
  VK: 'Kuh',
}
export const CATEGORY_SHORT: Record<CattleCategory, MeatValue['kind']> = { KV: 'Kalb', MT: 'Muni', MA: 'Muni', OB: 'Ochse', RG: 'Rind', VK: 'Kuh' }

/** CH-TAX ausgeschrieben, z.B. «T3» bzw. «+T3» (Proviande schreibt + und − vor das T) */
export const chtaxLabel = (f: Fleshiness, fat: FatClass) => `${f === '+' || f === '-' ? `${f === '-' ? '−' : '+'}T` : f}${fat}`

export type Sex = 'w' | 'm' | 'k' | null

/** Kategorie am Schlachttag. k = kastriert (Ochse). Rinder über 900 Tage und gekalbte Tiere gelten als Kuh. */
export function cattleCategory(sex: Sex, ageDays: number, calved: boolean): CattleCategory {
  if (ageDays <= 240) return 'KV'
  if (sex === 'm') return ageDays <= 600 ? 'MT' : 'MA'
  if (sex === 'k') return ageDays <= 840 ? 'OB' : 'VK'
  return calved || ageDays > 900 ? 'VK' : 'RG'
}

// ---- Preise ----

/** Wochenpreise «Kategorie Fleischigkeit» → CHF/kg SG und LG (Fettklasse 3), wie lib/proviande.ts (livestock) */
export type PriceTable = Record<string, { sg: number | null; lg: number | null }>

/** Proviande Woche 48/2026, falls die Wochenpreise (noch) nicht geladen sind. */
export const FALLBACK_CATTLE_PRICES: PriceTable = (() => {
  const t: PriceTable = {}
  const rows: [CattleCategory, (number | null)[], (number | null)[]][] = [
    ['MT', [12.1, 11.9, 11.7, 11.5, 11.3, 10.9, 10.6], [7.0, 6.8, 6.45, 6.1, 5.9, 5.55, 5.2]],
    ['OB', [12.1, 11.9, 11.7, 11.5, 11.3, 10.9, 10.6], [6.9, 6.65, 6.3, 6.0, 5.75, 5.45, 5.2]],
    ['RG', [12.1, 11.9, 11.7, 11.5, 11.3, null, null], [6.8, 6.55, 6.3, 6.0, 5.75, null, null]],
    ['KV', [19.5, 19.1, 18.8, 18.3, 17.9, 17.1, 15.3], [null, null, null, null, null, null, null]],
    ['VK', [10.65, 10.4, 10.2, 10.0, 9.65, 9.1, 8.45], [5.75, 5.4, 5.1, 4.8, 4.55, 4.2, 3.8]],
    ['MA', [9.65, 9.5, 9.35, 9.2, 8.95, 8.75, 8.3], [5.8, 5.5, 5.25, 4.95, 4.75, 4.55, 4.25]],
  ]
  for (const [c, sg, lg] of rows) FLESHINESS.forEach((f, i) => (t[`${c} ${f}`] = { sg: sg[i], lg: lg[i] }))
  return t
})()

/** Abzüge Fettklasse (CHF/kg SG) je Kategorie; VK und MA unterscheiden C–T und A–X. Proviande Woche 48/2026. */
const FAT_DEDUCTION: Record<CattleCategory, { ct: number[]; ax: number[] }> = {
  MT: { ct: [-0.9, -0.3, 0, -0.3, -0.9], ax: [-0.9, -0.3, 0, -0.3, -0.9] },
  OB: { ct: [-0.9, -0.3, 0, -0.3, -0.9], ax: [-0.9, -0.3, 0, -0.3, -0.9] },
  RG: { ct: [-0.9, -0.3, 0, -0.3, -0.9], ax: [-0.9, -0.3, 0, -0.3, -0.9] },
  KV: { ct: [-1.5, -0.4, 0, -0.2, -1.0], ax: [-1.5, -0.4, 0, -0.2, -1.0] },
  VK: { ct: [-0.2, 0, 0, -0.3, -0.7], ax: [-0.4, -0.1, 0, -0.3, -0.7] },
  MA: { ct: [-0.3, 0, 0, -0.3, -0.7], ax: [-0.3, 0, 0, -0.3, -0.7] },
}

/** Altersabzug Kälber 161–240 Tage (CHF/kg SG), Proviande Woche 48/2026. */
export function calfAgeDeduction(ageDays: number): number {
  if (ageDays <= 160 || ageDays > 240) return 0
  if (ageDays <= 180) return -0.1
  if (ageDays <= 190) return -0.5
  if (ageDays <= 200) return -0.7
  if (ageDays <= 210) return -0.9
  if (ageDays <= 220) return -1.1
  if (ageDays <= 230) return -1.3
  return -1.5
}

/** Ausbeute (A%) als Anteil, wenn die Tabelle keinen LG-Preis hat (Kälber; Proviande-Spalte A% Woche 48/2026). */
const FALLBACK_YIELD: Record<CattleCategory, number> = { KV: 0.58, MT: 0.53, MA: 0.54, OB: 0.52, RG: 0.52, VK: 0.48 }

/** Ausbeute SG/LG für Kategorie und Fleischigkeit: Preis LG / Preis SG derselben Zeile (= A% der Tabelle). */
export function carcassYield(cat: CattleCategory, f: Fleshiness, prices: PriceTable): number {
  for (const t of [prices, FALLBACK_CATTLE_PRICES]) {
    const row = t[`${cat === 'RG' && (f === 'A' || f === 'X') ? 'VK' : cat} ${f}`]
    if (row?.sg && row.lg) return Math.round((row.lg / row.sg) * 100) / 100
  }
  return FALLBACK_YIELD[cat]
}

export interface CattlePrice {
  /** Grundpreis der Zeile (Fettklasse 3), CHF/kg SG */
  base: number
  fat: number
  age: number
  /** nach Abzügen, vor dem Betriebsfaktor */
  perKg: number
  /** Preis aus der Ersatztabelle (Wochenpreise nicht geladen) */
  fallback: boolean
}

export function cattlePrice(cat: CattleCategory, f: Fleshiness, fat: FatClass, ageDays: number, prices: PriceTable): CattlePrice | null {
  // Rinder A–X werden zum Preis VK A–X abgerechnet
  const key = `${cat === 'RG' && (f === 'A' || f === 'X') ? 'VK' : cat} ${f}`
  let base = prices[key]?.sg ?? null
  let fallback = false
  if (base == null) {
    base = FALLBACK_CATTLE_PRICES[key]?.sg ?? null
    fallback = true
  }
  if (base == null) return null
  const d = FAT_DEDUCTION[cat]
  const fatDed = (f === 'A' || f === 'X' ? d.ax : d.ct)[fat - 1] ?? 0
  const age = cat === 'KV' ? calfAgeDeduction(ageDays) : 0
  return { base, fat: fatDed, age, perKg: Math.round((base + fatDed + age) * 100) / 100, fallback }
}

// ---- Wachstum ----

/** Rassenprofil: ausgewachsenes Lebendgewicht einer Kuh (kg). Tageszunahmen werden damit skaliert. */
const MATURE_KG: Record<string, number> = {
  HO: 700, RH: 680, RF: 680, SF: 720, SI: 750, FV: 720, BS: 680, BV: 680, OB: 620, JE: 450, EV: 450, HR: 520, HI: 450,
  LM: 750, CH: 800, AN: 650, AA: 650, LI: 700, BD: 780, PI: 720, DX: 350, GA: 600, HE: 650, SL: 750,
}
export const DEFAULT_MATURE_KG = 650

export function matureKg(breed: string | null | undefined): number | null {
  if (!breed) return null
  return MATURE_KG[breed.trim().toUpperCase().slice(0, 2)] ?? null
}

/** Rasse aus Abstammung: Mittel aus Vater und Mutter, sonst die Rasse des Tiers, sonst Standard. */
export function breedMature(own: string | null, sire: string | null, dam: string | null): { kg: number; basis: string } {
  const s = matureKg(sire)
  const d = matureKg(dam)
  if (s && d) return { kg: Math.round((s + d) / 2), basis: `Vater ${sire} × Mutter ${dam}` }
  const o = matureKg(own)
  if (o && s && s !== o) return { kg: Math.round((s + o) / 2), basis: `${own} × Vater ${sire}` }
  if (o) return { kg: o, basis: `Rasse ${own}` }
  if (s) return { kg: Math.round((s + DEFAULT_MATURE_KG) / 2), basis: `Vater ${sire}` }
  return { kg: DEFAULT_MATURE_KG, basis: 'Rasse unbekannt' }
}

const BIRTH_KG = 42

/** Lebendgewicht nach Alter (Tage): Tageszunahmen in Stufen, skaliert nach Rasse; männlich schwerer, mit Obergrenze. */
export function modelLiveKg(ageDays: number, mature: number, sex: Sex): number {
  const scale = mature / DEFAULT_MATURE_KG
  const male = sex === 'm' || sex === 'k'
  const m = male ? (sex === 'm' ? 1.25 : 1.12) : 1
  const steps: [number, number][] = [
    [180, 0.85],
    [450, 0.85],
    [800, 0.7],
    [Infinity, 0.35],
  ]
  let kg = BIRTH_KG * scale
  let from = 0
  for (const [to, adg] of steps) {
    const d = Math.min(Math.max(ageDays, 0), to) - from
    if (d <= 0) break
    kg += d * adg * scale * m
    from = to
  }
  const cap = mature * (sex === 'm' ? 1.5 : sex === 'k' ? 1.25 : 1)
  return Math.round(Math.min(kg, cap))
}

/** Lebendgewicht aus dem Brustumfang (cm), Messband. Heinrichs et al. 1992 (Holstein-Rinder), gültig etwa 80–230 cm. */
export function girthToLiveKg(cm: number): number | null {
  if (!Number.isFinite(cm) || cm < 70 || cm > 260) return null
  return Math.round(102.7 - 2.875 * cm + 0.02689 * cm * cm)
}

// ---- Schätzungen und Ergebnis ----

export type WeightMethod = 'waage' | 'messband' | 'auge'
export const METHOD_LABEL: Record<WeightMethod, string> = { waage: 'Waage', messband: 'Messband', auge: 'Auge' }

export interface WeightObs {
  date: string
  method: WeightMethod
  /** Lebendgewicht (Waage, Messband, Auge LG) */
  liveKg?: number | null
  /** Schlachtgewicht (Auge SG) */
  carcassKg?: number | null
}

export interface ChtaxObs {
  date: string
  fleshiness: Fleshiness
  fat: FatClass
}

export interface CattleInput {
  birthDate: string | null
  sex: Sex
  calved: boolean
  breed: string | null
  sireBreed: string | null
  damBreed: string | null
  weights: WeightObs[]
  chtax: ChtaxObs[]
}

export interface CattleSettings {
  /** Schlachttermin (JJJJ-MM-TT), leer = heute */
  slaughterDate: string
  /** Abzüge je Tier (Waagschein, Abgaben), Fr. */
  feePerAnimal: number
  /** Transport je Tier, Fr. */
  transportPerAnimal: number
  /** erzielter Preis im Verhältnis zum Wochenpreis */
  priceFactor: number
}

export const DEFAULT_CATTLE_SETTINGS: CattleSettings = { slaughterDate: '', feePerAnimal: 0, transportPerAnimal: 0, priceFactor: 1 }

/** Anpassung an die eigenen Abrechnungen: Faktor tatsächliches SG / Kurve, getrennt Kälber und ältere Tiere. */
export interface Calibration {
  calf: { factor: number; n: number } | null
  adult: { factor: number; n: number } | null
}

const DAY = 86_400_000
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

export interface CattleValue {
  category: CattleCategory
  ageDays: number
  /** geschätztes Schlachtgewicht */
  kg: number
  liveKg: number | null
  /** woher das Gewicht stammt, z.B. «Messband 12.10.2026» oder «Alter + Rasse HO, Abrechnungen ×1.05 (4)» */
  weightBasis: string
  fleshiness: Fleshiness
  fat: FatClass
  /** woher die Taxierung stammt: «eigene Schätzung 12.10.2026» oder «Annahme T3» */
  chtaxBasis: string
  price: CattlePrice
  /** Preis je kg nach Betriebsfaktor */
  pricePerKg: number
  gross: number
  net: number
}

const fmt = (iso: string) => iso.split('-').reverse().join('.')

export function cattleValue(input: CattleInput, date: string, prices: PriceTable, settings: CattleSettings = DEFAULT_CATTLE_SETTINGS, calib: Calibration | null = null): CattleValue | null {
  if (!input.birthDate) return null
  const ageDays = days(input.birthDate, date)
  if (ageDays < 0) return null
  const category = cattleCategory(input.sex, ageDays, input.calved)
  const tax = [...input.chtax].filter((c) => c.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  const fleshiness = tax?.fleshiness ?? 'T'
  const fat = tax?.fat ?? 3
  const price = cattlePrice(category, fleshiness, fat, ageDays, prices)
  if (!price) return null
  const yieldPct = carcassYield(category, fleshiness, prices)
  const breed = breedMature(input.breed, input.sireBreed, input.damBreed)
  const curve = (d: number) => modelLiveKg(d, breed.kg, input.sex)

  let kg: number
  let liveKg: number | null
  let weightBasis: string
  const obs = [...input.weights].filter((w) => w.date <= date && ((w.liveKg ?? 0) > 0 || (w.carcassKg ?? 0) > 0)).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (obs) {
    // bis zum Schlachttermin mit der Kurve fortschreiben (Verhältnis, damit schwere Tiere schwer bleiben)
    const at = Math.max(0, days(input.birthDate, obs.date))
    const grow = curve(at) > 0 ? curve(ageDays) / curve(at) : 1
    if (obs.carcassKg) {
      kg = obs.carcassKg * grow
      liveKg = kg / yieldPct
    } else {
      liveKg = (obs.liveKg as number) * grow
      kg = liveKg * yieldPct
    }
    weightBasis = `${METHOD_LABEL[obs.method]} ${fmt(obs.date)}${obs.carcassKg ? ' (SG)' : ''}${obs.date < date && Math.abs(grow - 1) > 0.01 ? ', fortgeschrieben' : ''}`
  } else {
    const c = category === 'KV' ? calib?.calf : calib?.adult
    const factor = c && c.n >= 2 ? c.factor : 1
    liveKg = curve(ageDays) * factor
    kg = liveKg * yieldPct
    weightBasis = `Alter + ${breed.basis}${c && c.n >= 2 ? `, Abrechnungen ×${factor.toFixed(2)} (${c.n})` : ''}`
  }
  kg = Math.round(kg)
  liveKg = liveKg != null ? Math.round(liveKg) : null
  const pricePerKg = Math.round(price.perKg * settings.priceFactor * 100) / 100
  const gross = kg * pricePerKg
  return {
    category,
    ageDays,
    kg,
    liveKg,
    weightBasis,
    fleshiness,
    fat,
    chtaxBasis: tax ? `eigene Schätzung ${fmt(tax.date)}` : 'Annahme T3',
    price,
    pricePerKg,
    gross,
    net: gross - settings.feePerAnimal - settings.transportPerAnimal,
  }
}

/** Faktor aus früheren Abrechnungen: Median von tatsächlichem SG / Kurve am Schlachttag. */
export function calibrate(records: { carcassKg: number; ageDays: number; sex: Sex; calved: boolean; mature: number; yieldPct?: number }[]): Calibration {
  const ratios = (calf: boolean) =>
    records
      .filter((r) => r.carcassKg > 0 && r.ageDays > 0 && (r.ageDays <= 240) === calf)
      .map((r) => {
        const cat = cattleCategory(r.sex, r.ageDays, r.calved)
        const sg = modelLiveKg(r.ageDays, r.mature, r.sex) * (r.yieldPct ?? FALLBACK_YIELD[cat])
        return r.carcassKg / sg
      })
      .filter((x) => x > 0.4 && x < 2.5)
      .sort((a, b) => a - b)
  const pick = (xs: number[]) => (xs.length ? { factor: Math.round(Math.min(1.5, Math.max(0.6, xs[Math.floor((xs.length - 1) / 2)] / 2 + xs[Math.ceil((xs.length - 1) / 2)] / 2)) * 100) / 100, n: xs.length } : null)
  return { calf: pick(ratios(true)), adult: pick(ratios(false)) }
}

/** Für Dashboard-Karten und Spaltensummen (gleiche Form wie der Fleischwert der Schafe). */
export function asMeatValue(v: CattleValue): MeatValue {
  return { band: v.category === 'KV' ? 'kalb' : v.category === 'VK' ? 'kuh' : 'rind', kind: CATEGORY_SHORT[v.category], ageDays: v.ageDays, kg: v.kg, pricePerKg: v.pricePerKg, gross: v.gross, net: v.net }
}

export function loadCattleSettings(moduleKey: string): CattleSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(`${moduleKey}_cattle_value_settings`) ?? 'null') as Partial<Record<keyof CattleSettings, unknown>> | null
    if (!raw) return DEFAULT_CATTLE_SETTINGS
    const out = { ...DEFAULT_CATTLE_SETTINGS }
    if (typeof raw.slaughterDate === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(raw.slaughterDate)) out.slaughterDate = raw.slaughterDate
    for (const k of ['feePerAnimal', 'transportPerAnimal', 'priceFactor'] as const) {
      const v = Number(raw[k])
      if (raw[k] != null && Number.isFinite(v) && v >= 0) out[k] = v
    }
    return out
  } catch {
    return DEFAULT_CATTLE_SETTINGS
  }
}

export function saveCattleSettings(moduleKey: string, s: CattleSettings): void {
  try {
    localStorage.setItem(`${moduleKey}_cattle_value_settings`, JSON.stringify(s))
  } catch {
    // nur bis zum Neuladen
  }
}
