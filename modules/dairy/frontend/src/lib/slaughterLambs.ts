// Lämmer zum Schlachttermin (pages/SlaughterLambs.tsx): wer am Termin noch als
// Lamm zählt (jünger als 420 Tage) und was es als Lamm bzw. später als Schaf
// bringen würde — gegenübergestellt dem Abstammungsindex aus der Lämmer-Selektion.

export interface SlaughterSettings {
  /** Preis Lämmer (LA T3), CHF je kg Schlachtgewicht */
  priceLamb: number
  /** Preis Schafe (SM T3), CHF je kg Schlachtgewicht */
  priceSheep: number
  /** erwartetes Schlachtgewicht ab dem Mindestalter, kg */
  carcassKg: number
  /** Mindestalter für das Schlachtgewicht, Monate */
  minAgeMonths: number
  /** Alter, ab dem ein Tier nicht mehr als Lamm zählt, Tage */
  lambMaxDays: number
}

export const DEFAULT_SLAUGHTER_SETTINGS: SlaughterSettings = {
  priceLamb: 13.4,
  priceSheep: 6.4,
  carcassKg: 22,
  minAgeMonths: 8,
  lambMaxDays: 420,
}

const DAY = 86_400_000
const DAYS_PER_MONTH = 30.4375

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

export interface SlaughterValue {
  /** Alter am Schlachttermin in Tagen */
  ageDays: number
  /** zählt am Termin als Lamm (jünger als lambMaxDays) */
  isLamb: boolean
  /** letzter Tag als Lamm */
  lambUntil: string
  /** Tage vom Termin bis zum Ende der Lamm-Zeit (negativ = schon vorbei) */
  daysLeftAsLamb: number
  /** Mindestalter erreicht (Schlachtgewicht ca. carcassKg) */
  ready: boolean
  /** Datum, an dem das Mindestalter erreicht ist */
  readyFrom: string
  /** Erlös am Termin (null = noch zu jung) */
  revenue: number | null
  /** Erlös als Schaf, falls das Tier über die Lamm-Zeit hinaus behalten wird */
  revenueAsSheep: number
}

export function slaughterValue(birthDate: string, slaughterDate: string, s: SlaughterSettings): SlaughterValue {
  const ageDays = daysBetween(birthDate, slaughterDate)
  const isLamb = ageDays < s.lambMaxDays
  const lambUntil = addDays(birthDate, s.lambMaxDays - 1)
  const readyDays = Math.ceil(s.minAgeMonths * DAYS_PER_MONTH)
  const ready = ageDays >= readyDays
  const asLamb = s.carcassKg * s.priceLamb
  const asSheep = s.carcassKg * s.priceSheep
  return {
    ageDays,
    isLamb,
    lambUntil,
    daysLeftAsLamb: daysBetween(slaughterDate, lambUntil),
    ready,
    readyFrom: addDays(birthDate, readyDays),
    revenue: ready ? round2(isLamb ? asLamb : asSheep) : null,
    revenueAsSheep: round2(asSheep),
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Für rankLambs: Altersgrenze in Monaten, die genau «jünger als lambMaxDays» abdeckt. */
export function lambMaxMonths(s: Pick<SlaughterSettings, 'lambMaxDays'>): number {
  return (s.lambMaxDays - 0.5) / DAYS_PER_MONTH
}
