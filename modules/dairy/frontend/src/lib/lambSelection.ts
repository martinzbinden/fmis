// Jungtier-Selektion (Remonte oder Mast) — Fortsetzung des bisherigen
// Selektionsablaufs der Milchschafe (Nextcloud …/scripts/selektion.py,
// WORKFLOW.md): bewertet wird die MUTTER (Leistung im Herdenvergleich und
// Zellzahl, lib/herdPerformance.ts), der Index des Jungtiers ist der
// Gesamtindex seiner Mutter. Ergänzungen gegenüber dem Original:
//
// - optional der Zuchtwert des Vaters (Schafe GZW, Kühe ISET) als dritte
//   Komponente — nur vorhanden, wenn der Vater ein eigenes, bewertetes Tier
//   ist; fehlt er, zählt er wie die anderen Teilwerte als 100;
// - die erwartete Inzucht des Jungtiers aus dem Stammbaum;
// - Jungtiere kommen aus den erfassten bzw. importierten Geburten (und dem
//   TVD-Tierbestand), die Tierliste aus der SMG ist nicht mehr nötig.
//
// Mit Gewicht Vater = 0 und Zellzahl über alle Kontrollen entspricht der
// Index genau `gesamtindex()` des Originals.

import type { PerformanceMetrics } from './herdPerformance'

export type Purpose = 'zucht' | 'mast'

export interface LambCandidate {
  key: string
  ear_tag: string
  name: string | null
  /** dairy-Tier, falls das Jungtier schon im Bestand geführt wird. */
  animal_id: string | null
  birth_date: string
  sex: 'w' | 'm' | null
  dam_key: string | null
  sire_key: string | null
  litter_size: number | null
  birth_weight_kg: number | null
}

export interface DamInfo {
  id: string
  ear_tag: string
  name: string | null
  lauf_nr: string | null
  performance: PerformanceMetrics | undefined
}

export interface SelectionSettings {
  weightPerformance: number
  weightScc: number
  weightSire: number
  maxAgeMonths: number
  /** Zellzahl nur der letzten 12 Monate statt aller Kontrollen. */
  scc12m: boolean
}

export const DEFAULT_SELECTION_SETTINGS: SelectionSettings = {
  weightPerformance: 0.6,
  weightScc: 0.4,
  weightSire: 0,
  maxAgeMonths: 8,
  scc12m: false,
}

export interface LambRow extends LambCandidate {
  age_days: number
  dam: DamInfo | null
  sire_value: number | null
  inbreeding: number
  idx_performance: number | null
  idx_scc: number | null
  index: number | null
  /** Anzahl weiblicher Jungtiere derselben Mutter in der Auswahl. */
  dam_daughters: number
  purpose: Purpose | null
  rank: number | null
}

const DAYS_PER_MONTH = 30.4375

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/** Gewichteter Gesamtindex; Gewichte werden auf Summe 1 normiert, fehlende
 * Teilwerte = Herdenmittel 100 (wie im Original). Ohne bewertete Mutter kein
 * Index — das Original setzt solche Jungtiere ans Tabellenende. */
export function lambIndex(
  idxPerformance: number | null,
  idxScc: number | null,
  sireValue: number | null,
  s: Pick<SelectionSettings, 'weightPerformance' | 'weightScc' | 'weightSire'>,
): number | null {
  if (idxPerformance == null && idxScc == null) return null
  const total = s.weightPerformance + s.weightScc + s.weightSire
  if (total <= 0) return null
  return round1(
    (s.weightPerformance * (idxPerformance ?? 100) + s.weightScc * (idxScc ?? 100) + s.weightSire * (sireValue ?? 100)) / total,
  )
}

export function rankLambs(input: {
  candidates: LambCandidate[]
  dams: Map<string, DamInfo>
  sireValues: Map<string, number>
  inbreeding: (dam: string | null, sire: string | null) => number
  decisions: Map<string, Purpose | null>
  settings: SelectionSettings
  today: string
}): LambRow[] {
  const { settings: s } = input
  const todayMs = Date.parse(`${input.today}T00:00:00Z`)
  const maxDays = s.maxAgeMonths * DAYS_PER_MONTH
  const rows: LambRow[] = []
  for (const c of input.candidates) {
    const age = Math.round((todayMs - Date.parse(`${c.birth_date}T00:00:00Z`)) / 86_400_000)
    if (age < 0 || age > maxDays) continue
    const dam = c.dam_key ? (input.dams.get(c.dam_key) ?? null) : null
    const perf = dam?.performance
    const idxPerformance = perf?.idx_performance ?? null
    const idxScc = (s.scc12m ? perf?.idx_scc_12m : perf?.idx_scc) ?? null
    const sireValue = c.sire_key ? (input.sireValues.get(c.sire_key) ?? null) : null
    rows.push({
      ...c,
      age_days: age,
      dam,
      sire_value: sireValue,
      inbreeding: input.inbreeding(c.dam_key, c.sire_key),
      idx_performance: idxPerformance,
      idx_scc: idxScc,
      index: perf ? lambIndex(idxPerformance, idxScc, sireValue, s) : null,
      dam_daughters: 0,
      purpose: input.decisions.get(c.key) ?? null,
      rank: null,
    })
  }
  const daughters = new Map<string, number>()
  for (const r of rows) if (r.sex === 'w' && r.dam_key) daughters.set(r.dam_key, (daughters.get(r.dam_key) ?? 0) + 1)
  for (const r of rows) r.dam_daughters = r.dam_key ? (daughters.get(r.dam_key) ?? 0) : 0

  rows.sort((a, b) => {
    if (a.index == null && b.index == null) return b.birth_date.localeCompare(a.birth_date)
    if (a.index == null) return 1
    if (b.index == null) return -1
    return b.index - a.index
  })
  // Rang nur unter den weiblichen Jungtieren (Remonte-Kandidatinnen).
  let rank = 0
  for (const r of rows) if (r.sex === 'w' && r.index != null) r.rank = ++rank
  return rows
}
