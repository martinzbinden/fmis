// Fleischwert (Schlachterlös) eines Schafs, geschätzt aus Alter und Proviande-Preis — für das Dashboard
// (pages/Board.tsx), um Schlachtgruppen zu vergleichen. Die Vorgaben stammen aus den Abrechnungen
// der Metzgerschaft (Waagscheine 2025: 21 Lämmer, 13 Schafe): Schlachtgewicht (SG) je Altersstufe,
// erzielter Preis im Verhältnis zum Wochenpreis T3, Abzüge je Tier.
// Lämmer wogen unabhängig vom Alter ca. 13–15 kg SG (Mittel 14.2), Schafe 16–36 kg (Mittel 25).

export interface MeatSettings {
  /** Schlachttermin (JJJJ-MM-TT), leer = heute */
  slaughterDate: string
  /** Alter, ab dem ein Tier nicht mehr als Lamm zählt (Tage) */
  lambMaxDays: number
  /** Lamm: SG bis 120 Tage / bis 210 Tage / älter (kg) */
  lambKgYoung: number
  lambKgMid: number
  lambKgOld: number
  /** Schaf: SG unter / ab 1400 Tagen (kg) */
  sheepKgYoung: number
  sheepKgOld: number
  /** erzielter Preis im Verhältnis zum Wochenpreis T3 */
  lambFactor: number
  sheepFactor: number
  /** Abzüge je Tier: Waagschein 3.00 + TS-Prävention 0.40 + Proviande 0.28 */
  feePerAnimal: number
  /** Transport je Tier (150 Fr. für 20 Tiere) */
  transportPerAnimal: number
}

export const DEFAULT_MEAT_SETTINGS: MeatSettings = {
  slaughterDate: '',
  lambMaxDays: 420,
  lambKgYoung: 14.5,
  lambKgMid: 14.8,
  lambKgOld: 13.2,
  sheepKgYoung: 19,
  sheepKgOld: 27,
  lambFactor: 0.95,
  sheepFactor: 1,
  feePerAnimal: 3.68,
  transportPerAnimal: 7.5,
}

export interface MeatPrices {
  /** Lämmer LA T3, CHF/kg SG */
  lamb: number
  /** Schafe SM T3, CHF/kg SG */
  sheep: number
}

/** Falls die Proviande-Preise noch nicht geladen sind (Stand Woche 47/2026). */
export const FALLBACK_MEAT_PRICES: MeatPrices = { lamb: 13.4, sheep: 6.3 }

/** Bereiche für die Grafik: Schaf (ein Bereich) und Lamm nach Alter (wie die Gewichtsstufen). */
export type MeatBand = 'lamm1' | 'lamm2' | 'lamm3' | 'schaf'
export const MEAT_BANDS: MeatBand[] = ['lamm1', 'lamm2', 'lamm3', 'schaf']
export const MEAT_BAND_LABEL: Record<MeatBand, string> = { lamm1: 'Lamm bis 120 T.', lamm2: 'Lamm bis 210 T.', lamm3: 'Lamm älter', schaf: 'Schaf' }
/** Tailwind-Klassen je Bereich (Balken); helle bis dunkle Grüntöne für die Lämmer, Grau für Schafe */
export const MEAT_BAND_BAR: Record<MeatBand, string> = { lamm1: 'bg-lime-300', lamm2: 'bg-green-500', lamm3: 'bg-green-800', schaf: 'bg-stone-500' }

export interface MeatValue {
  band: MeatBand
  kind: 'Lamm' | 'Schaf'
  ageDays: number
  kg: number
  pricePerKg: number
  /** Erlös vor Abzügen */
  gross: number
  /** nach Waagschein-Abzügen und Transport */
  net: number
}

const DAY = 86_400_000
export const ageOnDate = (birthIso: string, dateIso: string) => Math.round((Date.parse(`${dateIso}T00:00:00Z`) - Date.parse(`${birthIso}T00:00:00Z`)) / DAY)

export function meatValue(birthDate: string | null, date: string, s: MeatSettings, p: MeatPrices): MeatValue | null {
  if (!birthDate) return null
  const ageDays = ageOnDate(birthDate, date)
  if (ageDays < 0) return null
  const lamb = ageDays < s.lambMaxDays
  const kg = lamb ? (ageDays <= 120 ? s.lambKgYoung : ageDays <= 210 ? s.lambKgMid : s.lambKgOld) : ageDays < 1400 ? s.sheepKgYoung : s.sheepKgOld
  const pricePerKg = (lamb ? p.lamb * s.lambFactor : p.sheep * s.sheepFactor)
  const gross = kg * pricePerKg
  const band: MeatBand = lamb ? (ageDays <= 120 ? 'lamm1' : ageDays <= 210 ? 'lamm2' : 'lamm3') : 'schaf'
  return { band, kind: lamb ? 'Lamm' : 'Schaf', ageDays, kg, pricePerKg, gross, net: gross - s.feePerAnimal - s.transportPerAnimal }
}

export interface MeatSum {
  lambs: number
  sheep: number
  unknown: number
  gross: number
  net: number
  /** Tiere und Wert nach Bereich (für den Balken) */
  byBand: Record<MeatBand, { n: number; net: number }>
}

export function sumMeat(values: (MeatValue | null)[]): MeatSum {
  const out: MeatSum = { lambs: 0, sheep: 0, unknown: 0, gross: 0, net: 0, byBand: { lamm1: { n: 0, net: 0 }, lamm2: { n: 0, net: 0 }, lamm3: { n: 0, net: 0 }, schaf: { n: 0, net: 0 } } }
  for (const v of values) {
    if (!v) out.unknown++
    else {
      if (v.kind === 'Lamm') out.lambs++
      else out.sheep++
      out.gross += v.gross
      out.net += v.net
      out.byBand[v.band].n++
      out.byBand[v.band].net += v.net
    }
  }
  return out
}

/** Einstellungen lesen/schreiben: je Gerät (localStorage), unbekannte oder ungültige Werte fallen auf die Vorgaben zurück. */
export function loadMeatSettings(moduleKey: string): MeatSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(`${moduleKey}_meat_settings`) ?? 'null') as Partial<Record<keyof MeatSettings, unknown>> | null
    if (!raw) return DEFAULT_MEAT_SETTINGS
    const out = { ...DEFAULT_MEAT_SETTINGS }
    for (const k of Object.keys(out) as (keyof MeatSettings)[]) {
      if (k === 'slaughterDate') {
        if (typeof raw[k] === 'string' && /^\d{4}-\d{2}-\d{2}$|^$/.test(raw[k] as string)) out[k] = raw[k] as string
      } else {
        const v = Number(raw[k])
        if (raw[k] != null && Number.isFinite(v) && v >= 0) (out as Record<string, unknown>)[k] = v
      }
    }
    return out
  } catch {
    return DEFAULT_MEAT_SETTINGS
  }
}

export function saveMeatSettings(moduleKey: string, s: MeatSettings): void {
  try {
    localStorage.setItem(`${moduleKey}_meat_settings`, JSON.stringify(s))
  } catch {
    // nur bis zum Neuladen
  }
}
