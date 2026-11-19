// Geldwert eines Jungtiers als künftiges Zuchttier, geschätzt aus der Abstammung (Lämmerauswahl und Dashboard-Karte).
//
// Gerechnet wird der Mehr- oder Minderwert gegenüber einem durchschnittlichen Jungtier der Herde, nur aus der Milchmenge:
//
//   Mutter:  Leistung im Herdenvergleich (performance_rel, 1 = Herdenmittel) → Abweichung in %. Wie viel davon Erbgut ist,
//            folgt aus Erblichkeit h² und Wiederholbarkeit r über ihre n Laktationen: b = n·h² / (1 + (n−1)·r).
//   Vater:   Zuchtwert (GZW/ISET, Mittel 100) → (Wert − 100) × «Milch-% je Punkt».
//   Jungtier erbt je die Hälfte:  Erwartung % = ½ · b · Mutter-% + ½ · Vater-%
//   Franken: Erwartung % × Herdenmittel kg je Laktation × Milchpreis × erwartete Laktationen.
//
// Fehlt ein Elternteil, zählt er als Durchschnitt (0 %). Ohne bewertete Mutter und ohne Vater-Zuchtwert keine Schätzung.
// Zellzahl, Gehalte und Fitness fliessen nicht ein (die Lämmerauswahl gewichtet sie im Index).

import type { Species } from './fertility'

export interface LambValueSettings {
  /** Erblichkeit der Milchmenge */
  heritability: number
  /** Wiederholbarkeit der Laktationsleistung (Mutter) */
  repeatability: number
  /** Milch-% je Zuchtwert-Punkt des Vaters über bzw. unter 100 */
  sirePctPerPoint: number
  /** erwartete Laktationen als Zuchttier */
  lactations: number
}

export const DEFAULT_LAMB_VALUE: Record<Species, LambValueSettings> = {
  sheep: { heritability: 0.3, repeatability: 0.45, sirePctPerPoint: 1, lactations: 4 },
  cattle: { heritability: 0.3, repeatability: 0.5, sirePctPerPoint: 1, lactations: 3 },
}

export const LAMB_VALUE_FIELDS: { key: keyof LambValueSettings; label: string; step: number }[] = [
  { key: 'heritability', label: 'Erblichkeit Milchmenge (h², 0–1)', step: 0.05 },
  { key: 'repeatability', label: 'Wiederholbarkeit Laktationsleistung (0–1)', step: 0.05 },
  { key: 'sirePctPerPoint', label: 'Vater: Milch-% je Zuchtwert-Punkt über 100', step: 0.1 },
  { key: 'lactations', label: 'Erwartete Laktationen als Zuchttier', step: 1 },
]

const key = (moduleKey: string) => `${moduleKey}_lamb_value`

export function loadLambValueSettings(moduleKey: string, species: Species): LambValueSettings {
  const out = { ...DEFAULT_LAMB_VALUE[species] }
  try {
    const raw = JSON.parse(localStorage.getItem(key(moduleKey)) ?? 'null') as Partial<Record<keyof LambValueSettings, unknown>> | null
    if (raw)
      for (const k of Object.keys(out) as (keyof LambValueSettings)[]) {
        const v = Number(raw[k])
        if (raw[k] != null && Number.isFinite(v) && v >= 0) out[k] = v
      }
  } catch {
    // Vorgaben
  }
  return out
}

export function saveLambValueSettings(moduleKey: string, s: LambValueSettings): void {
  try {
    localStorage.setItem(key(moduleKey), JSON.stringify(s))
  } catch {
    // nur bis zum Neuladen
  }
}

export interface LambValueInput {
  /** Leistung der Mutter relativ zur Herde (1 = Mittel), null = nicht bewertet */
  damRel: number | null
  /** Laktationen der Mutter, auf denen die Leistung beruht (0 = Erstling in der ersten Laktation, zählt als 1) */
  damLactations: number
  /** Zuchtwert des Vaters (Mittel 100), null = unbekannt */
  sireValue: number | null
}

export interface LambValue {
  /** erwartete Milch des Jungtiers gegenüber dem Herdenmittel, % */
  pct: number
  /** Beitrag der Mutter bzw. des Vaters (je schon halbiert), % */
  damPart: number | null
  sirePart: number | null
  kgPerLactation: number
  francs: number
}

const r1 = (v: number) => Math.round(v * 10) / 10

export function lambValue(i: LambValueInput, s: LambValueSettings, herdKgPerLactation: number | null, milkPrice: number): LambValue | null {
  if (!herdKgPerLactation || herdKgPerLactation <= 0) return null
  // bewertet heisst mindestens eine Laktation (Erstlinge: laufende Standardlaktation, noch keine abgeschlossene)
  const n = Math.max(1, Math.round(i.damLactations))
  const damPart = i.damRel != null ? 0.5 * ((n * s.heritability) / (1 + (n - 1) * s.repeatability)) * (i.damRel - 1) * 100 : null
  const sirePart = i.sireValue != null ? 0.5 * (i.sireValue - 100) * s.sirePctPerPoint : null
  if (damPart == null && sirePart == null) return null
  const pct = (damPart ?? 0) + (sirePart ?? 0)
  const kgPerLactation = (pct / 100) * herdKgPerLactation
  return {
    pct: r1(pct),
    damPart: damPart == null ? null : r1(damPart),
    sirePart: sirePart == null ? null : r1(sirePart),
    kgPerLactation: r1(kgPerLactation),
    francs: Math.round(kgPerLactation * s.lactations * milkPrice),
  }
}

/** Herdenmittel Milch je Laktation: Laktationen mit mindestens 100 Melktagen, Abkalbung in den letzten 4 Jahren. */
export function herdMeanLactationKg(lactations: { milk_kg: number | null; days_in_milk: number | null; calving_date: string | null }[], today: string): number | null {
  const from = `${Number(today.slice(0, 4)) - 4}${today.slice(4)}`
  const kg = lactations.filter((l) => l.milk_kg != null && l.milk_kg > 0 && (l.days_in_milk ?? 0) >= 100 && l.calving_date != null && l.calving_date >= from).map((l) => l.milk_kg!)
  return kg.length >= 5 ? Math.round(kg.reduce((a, b) => a + b, 0) / kg.length) : null
}

/** Kurztext für Tooltip und Tabelle */
export function lambValueTip(v: LambValue, s: LambValueSettings, herdKg: number, milkPrice: number): string {
  const sign = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toLocaleString('de-CH')}`
  return [
    `Erwartete Milch ${sign(v.pct)} % gegenüber dem Herdenmittel (${herdKg.toLocaleString('de-CH')} kg je Laktation): ${sign(v.kgPerLactation)} kg je Laktation`,
    `Mutter ${v.damPart == null ? 'nicht bewertet (zählt als Mittel)' : `${sign(v.damPart)} %`} · Vater ${v.sirePart == null ? 'ohne Zuchtwert (zählt als Mittel)' : `${sign(v.sirePart)} %`}`,
    `× ${s.lactations} Laktationen × ${milkPrice.toFixed(2)} Fr./kg = ${sign(v.francs)} Fr. gegenüber einem Durchschnittstier`,
  ].join('\n')
}
