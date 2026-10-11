// Vermarktung eines Lamms oder Schafs: was es über den Markt (Proviande-
// Preis nach CH-TAX) bringt, und was über die eigene Direktvermarktung
// (Metzger schlachtet, zerlegt, verpackt; Verkauf ab Hof) übrig bleibt.
// Reine Rechenfunktionen — die Seite «Vermarktung» und das Erfassen einer
// Schlachtung holen die Preise aus market_prices / direct_marketing_settings.

export type Fleshiness = 'C' | 'H' | 'T' | 'A' | 'X'
export type FatClass = 1 | 2 | 3 | 4 | 5
export type Category = 'LA' | 'SM'

export interface MarketPrices {
  /** Lämmer LA, Fleischigkeit T, Fettklasse 3, Fr./kg SG */
  la_t3: number
  /** Schafe SM (ab 421 Tagen, oder Lämmer über 28 kg SG), T3, Fr./kg SG */
  sm_t3: number
  /** Zuschlag Bio, Fr./kg SG — 0, solange die Tiere in den konventionellen Kanal gehen */
  bio_premium: number
  /** Waagschein 3.00, TS-Präventionsabgabe 0.40, Abgabe Proviande 0.32 — je Tier */
  fee_per_animal: number
}

export interface DirectMarketingSettings {
  /** Fleischschau, Schlachtabfall, Abgabe Tierseuchen — je Tier */
  fee_per_animal: number
  /** Schlachten + Ausbeinen/Zerlegen — je kg SG */
  fee_per_kg_carcass: number
  /** verkaufbares Fleisch in % vom Schlachtgewicht */
  meat_yield_pct: number
  /** Entsorgen von Fett und Knochen — je kg, das nicht Fleisch wird */
  disposal_per_kg: number
  /** durchschnittliches Paket (Vakuumbeutel) in Gramm */
  pack_grams: number
  /** Vakuum + Etikette — je Paket */
  fee_per_pack: number
  /** Anteil des Fleischs, der zu Wurst/Hack verarbeitet wird, in % */
  sausage_share_pct: number
  /** Herstellung Wurst/Hack — je kg */
  sausage_fee_per_kg: number
  /** MwSt auf der Metzgerrechnung in % */
  vat_pct: number
  /** Mischpreis im Verkauf, je kg Fleisch */
  meat_price_per_kg: number
}

/** Proviande Woche 42/2026 (gültig ab 12.10.2026), SBV-Wochenbericht. */
export const DEFAULT_MARKET_PRICES: MarketPrices = { la_t3: 13.6, sm_t3: 6.5, bio_premium: 0, fee_per_animal: 3.72 }

/**
 * Aus den Rechnungen der Schärer GmbH, Schwarzenburg (2024–2026); nachgerechnet
 * an 5 Lämmern vom Juli 2026: 920.70 gerechnet gegen 922.40 verrechnet.
 * Mischpreis: «Lamm ganz mit Knochen», 10 kg für 320.–.
 */
export const DEFAULT_DIRECT_MARKETING: DirectMarketingSettings = {
  fee_per_animal: 16.4,
  fee_per_kg_carcass: 2.8,
  meat_yield_pct: 56,
  disposal_per_kg: 0.5,
  pack_grams: 430,
  fee_per_pack: 0.57,
  sausage_share_pct: 65,
  sausage_fee_per_kg: 7,
  vat_pct: 2.6,
  meat_price_per_kg: 32,
}

// Proviande-Wochenpreise Lämmer/Schafe, Abstand der Fleischigkeitsklassen zu T
// (Woche 42/2026: LA 14.30/14.00/13.60/13.10/11.00, SM 7.30/6.90/6.50/6.00/5.30).
const FLESH_DELTA: Record<Category, Record<Fleshiness, number>> = {
  LA: { C: 0.7, H: 0.4, T: 0, A: -0.5, X: -2.6 },
  SM: { C: 0.8, H: 0.4, T: 0, A: -0.5, X: -1.2 },
}
const FAT_DEDUCTION: Record<Category, Record<FatClass, number>> = {
  LA: { 1: -1.5, 2: -0.4, 3: 0, 4: -0.9, 5: -3 },
  SM: { 1: 0, 2: 0, 3: 0, 4: -1.1, 5: -3 },
}
/** Schlachtausbeute LA in % vom Lebendgewicht, je Fleischigkeit (Proviande). */
const CARCASS_YIELD: Record<Fleshiness, number> = { C: 0.48, H: 0.47, T: 0.46, A: 0.45, X: 0.44 }

// Gewichtsabzüge Schlachtlämmer LA, Fr./kg SG: [bis kg SG, Abzug].
const LA_WEIGHT_DEDUCTIONS: [number, number][] = [
  [20.5, 0], [21, 0.2], [21.5, 0.4], [22, 0.6], [22.5, 0.85], [23, 1.05],
  [23.5, 1.9], [24, 2.1], [24.5, 2.35], [25, 2.55], [28, 4],
]
/** Ab hier Gewichtsabzug (kg SG / kg LG laut Proviande-Tabelle). */
export const LA_DEDUCTION_FROM_SG = 20.5
export const LA_DEDUCTION_FROM_LG = 43
/** Darüber wird ein Lamm zum Schafpreis abgerechnet. */
export const LA_MAX_SG = 28
export const LA_MAX_LG = 58

const ORDER: Fleshiness[] = ['C', 'H', 'T', 'A', 'X']

export interface Grade {
  fleshiness: Fleshiness
  /** -1, 0, +1 für T-, T, T+ */
  sub: -1 | 0 | 1
  fat: FatClass
}

/** «T3+», «T+3», «H 3», «t3» → Klasse; ohne Angabe T3. */
export function parseGrade(classification: string | null | undefined, fatClass?: string | null): Grade {
  const text = (classification ?? '').toUpperCase().replace(/\s+/g, '')
  const letter = (text.match(/[CHTAX]/)?.[0] ?? 'T') as Fleshiness
  const sub = text.includes('+') ? 1 : text.includes('-') ? -1 : 0
  const fatDigit = Number((fatClass ?? '').match(/[1-5]/)?.[0] ?? text.match(/[1-5]/)?.[0] ?? 3)
  return { fleshiness: letter, sub, fat: fatDigit as FatClass }
}

export function formatGrade(g: Grade): string {
  return `${g.fleshiness}${g.fat}${g.sub > 0 ? '+' : g.sub < 0 ? '−' : ''}`
}

/** Fleischigkeit samt Unterklasse: ein Drittel des Abstands zur Nachbarklasse. */
function fleshDelta(cat: Category, g: Grade): number {
  const table = FLESH_DELTA[cat]
  const base = table[g.fleshiness]
  if (g.sub === 0) return base
  const i = ORDER.indexOf(g.fleshiness)
  const neighbour = ORDER[g.sub > 0 ? i - 1 : i + 1]
  if (!neighbour) return base
  return base + (table[neighbour] - base) / 3
}

export function laWeightDeduction(carcassKg: number): number {
  for (const [upTo, deduction] of LA_WEIGHT_DEDUCTIONS) if (carcassKg <= upTo) return deduction
  return 0
}

export interface MarketResult {
  category: Category
  basePerKg: number
  gradeDelta: number
  weightDeduction: number
  pricePerKg: number
  /** netto nach den Gebühren je Tier */
  revenue: number
}

/**
 * Proviande-Preis für ein Tier. Lämmer über 28 kg SG und Schafe (adult=true)
 * gehen zum SM-Preis. Bio-Zuschlag kommt obendrauf.
 */
export function marketValue(carcassKg: number, grade: Grade, prices: MarketPrices, adult = false): MarketResult {
  const category: Category = adult || carcassKg > LA_MAX_SG ? 'SM' : 'LA'
  const basePerKg = category === 'LA' ? prices.la_t3 : prices.sm_t3
  const gradeDelta = fleshDelta(category, grade) + FAT_DEDUCTION[category][grade.fat]
  const weightDeduction = category === 'LA' ? laWeightDeduction(carcassKg) : 0
  const pricePerKg = Math.max(0, basePerKg + gradeDelta - weightDeduction + prices.bio_premium)
  const revenue = pricePerKg * carcassKg - prices.fee_per_animal
  return { category, basePerKg, gradeDelta, weightDeduction, pricePerKg, revenue }
}

/** Geschätztes Schlachtgewicht aus dem Lebendgewicht (Ausbeute nach Fleischigkeit). */
export function estimateCarcassKg(liveKg: number, grade: Grade): number {
  return liveKg * CARCASS_YIELD[grade.fleshiness]
}

export interface DirectResult {
  meatKg: number
  packs: number
  butcherCost: number
  meatValue: number
  net: number
}

/** Direktvermarktung: Verkaufswert des Fleischs minus Metzgerrechnung (inkl. MwSt). */
export function directValue(carcassKg: number, s: DirectMarketingSettings, animals = 1): DirectResult {
  const meatKg = carcassKg * s.meat_yield_pct / 100
  const packs = s.pack_grams > 0 ? Math.ceil(meatKg * 1000 / s.pack_grams) : 0
  const costExVat =
    s.fee_per_animal * animals +
    s.fee_per_kg_carcass * carcassKg +
    s.disposal_per_kg * (carcassKg - meatKg) +
    s.fee_per_pack * packs +
    s.sausage_fee_per_kg * meatKg * s.sausage_share_pct / 100
  const butcherCost = costExVat * (1 + s.vat_pct / 100)
  const meatValue = meatKg * s.meat_price_per_kg
  return { meatKg, packs, butcherCost, meatValue, net: meatValue - butcherCost }
}
