// Ausmerzliste: je Muttertier nachvollziehbare Gründe mit Klartext statt
// einer undurchsichtigen Punktzahl. Jeder Grund kommt aus genau einem
// Schwellenwert; die Liste sortiert nach Summe der Gewichte. Entschieden wird
// am Tier — die Liste macht nur sichtbar, wo es sich lohnt hinzuschauen.

import type { FertilityStatus, Species } from './fertility'
import type { PerformanceMetrics } from './herdPerformance'
import { levelSeries, type LactationTrend } from './lactationTrend'

export interface CullingThresholds {
  /** ZKZ/ZLZ des letzten abgeschlossenen Zyklus über … Tage */
  intervalDays: number
  /** Belegungen bis zur Trächtigkeit (letzter Zyklus oder laufend) ab … */
  services: number
  /** Tage seit Geburt ohne Belegung über … (0 = aus, z.B. saisonale Schafe) */
  daysWithoutService: number
  /** Zellzahl, geometrisches Mittel 12 Monate, über … (1000/ml) */
  sccGeo12m: number
  /** Einzelprobe gilt als hoch über … (1000/ml) */
  sccHighTest: number
  /** so viele hohe Proben in der laufenden Laktation */
  sccHighCount: number
  /** relative, altersstandardisierte Leistung unter … (1.00 = Herdenschnitt) */
  performanceRel: number
  /** Gesamtzuchtwert unter … (Kühe ISET Basis 1000, Schafe GZW Basis 100) */
  totalBreedingValue: number
  /** Zuchtwert Zellzahl oder Mastitisresistenz unter … (nur Kühe, Basis 100) */
  udderBreedingValue: number
  /** Laktationsnummer ab … (Hinweis) */
  lactationNumber: number
  /** Anteil tote Nachkommen in den letzten zwei Geburten ab … (0 = aus) */
  offspringLossShare: number
  /** Krankheits-/Behandlungstage im Journal der letzten 12 Monate ab … (0 = aus) */
  healthEvents12m: number
  /** Leistung (Niveau im Herdenvergleich) fällt seit … Laktationen in Folge (0 = aus) */
  trendFalling: number
  /** laufende Laktation mindestens … Prozentpunkte unter dem eigenen Mittel (0 = aus) */
  runningBelowOwn: number
}

export const DEFAULT_THRESHOLDS: Record<Species, CullingThresholds> = {
  cattle: {
    intervalDays: 420,
    services: 3,
    daysWithoutService: 90,
    sccGeo12m: 200,
    sccHighTest: 200,
    sccHighCount: 3,
    performanceRel: 0.85,
    totalBreedingValue: 925,
    udderBreedingValue: 90,
    lactationNumber: 8,
    offspringLossShare: 0,
    healthEvents12m: 3,
    trendFalling: 2,
    runningBelowOwn: 15,
  },
  sheep: {
    intervalDays: 400,
    services: 2,
    daysWithoutService: 0,
    sccGeo12m: 500,
    sccHighTest: 1000,
    sccHighCount: 3,
    performanceRel: 0.85,
    totalBreedingValue: 90,
    udderBreedingValue: 0,
    lactationNumber: 7,
    offspringLossShare: 0.5,
    healthEvents12m: 2,
    trendFalling: 2,
    runningBelowOwn: 15,
  },
}

export type ReasonArea = 'fruchtbarkeit' | 'euter' | 'leistung' | 'zucht' | 'alter' | 'nachkommen' | 'gesundheit'

export interface CullingReason {
  area: ReasonArea
  weight: number
  text: string
}

export interface CullingInput {
  species: Species
  fertility: FertilityStatus
  performance: PerformanceMetrics | undefined
  /** Milchproben der laufenden Laktation (seit der letzten Geburt). */
  currentLactationScc: (number | null)[]
  /** Neuester Wert je Zuchtwert-Merkmal. */
  breedingValues: Record<string, number>
  lactationNumber: number | null
  /** Nachkommen der letzten zwei Geburten. */
  recentOffspring: { stillborn: boolean; died_24h: boolean }[]
  /** Tage mit Krankheits-/Behandlungseinträgen in den letzten 12 Monaten,
   * mit den Diagnosen (für den Klartext). */
  healthEvents12m?: { date: string; diagnosis: string | null }[]
  /** Tendenz über die Laktationen (lib/lactationTrend.ts). */
  trend?: LactationTrend
}

/** Zellzahl in 1000/ml als ausgeschriebene Zahl mit Schweizer Tausender-
 * Apostroph, z.B. 1000 → "1'000'000". */
export function fmtCells(thousands: number): string {
  return String(Math.round(thousands * 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

export function cullingReasons(input: CullingInput, t: CullingThresholds): CullingReason[] {
  const reasons: CullingReason[] = []
  const { fertility: f, performance: p } = input
  const term = input.species === 'sheep' ? { interval: 'ZLZ', birth: 'Ablammung' } : { interval: 'ZKZ', birth: 'Abkalbung' }

  const lastCompleted = [...f.cycles].reverse().find((c) => c.interval_days != null)
  if (t.intervalDays > 0 && lastCompleted && lastCompleted.interval_days! > t.intervalDays) {
    reasons.push({ area: 'fruchtbarkeit', weight: 2, text: `${term.interval} ${lastCompleted.interval_days} Tage (Grenze ${t.intervalDays})` })
  }
  const lastCycle = f.cycles.at(-1)
  const currentServices = f.services_since_birth
  const lastServices = lastCompleted?.services ?? 0
  if (t.services > 0 && Math.max(currentServices, lastServices) >= t.services) {
    const n = Math.max(currentServices, lastServices)
    const when = currentServices >= lastServices ? `seit der letzten ${term.birth}` : 'bis zur letzten Trächtigkeit'
    reasons.push({ area: 'fruchtbarkeit', weight: 2, text: `${n} Belegungen ${when}` })
  }
  if (
    t.daysWithoutService > 0 &&
    lastCycle &&
    currentServices === 0 &&
    f.days_since_birth != null &&
    f.days_since_birth > t.daysWithoutService
  ) {
    reasons.push({ area: 'fruchtbarkeit', weight: 1, text: `${f.days_since_birth} Tage seit ${term.birth}, noch nicht belegt` })
  }

  if (p?.scc_geo_12m != null && p.scc_geo_12m > t.sccGeo12m) {
    reasons.push({ area: 'euter', weight: 2, text: `Zellzahl Ø 12 Monate ${fmtCells(p.scc_geo_12m)} (Grenze ${fmtCells(t.sccGeo12m)})` })
  }
  const tests = input.currentLactationScc.filter((v): v is number => v != null)
  const high = tests.filter((v) => v > t.sccHighTest).length
  if (t.sccHighCount > 0 && high >= t.sccHighCount) {
    reasons.push({ area: 'euter', weight: 2, text: `${high} von ${tests.length} Proben dieser Laktation über ${fmtCells(t.sccHighTest)} Zellen` })
  }
  for (const [trait, label] of [['scc', 'Zuchtwert Zellzahl'], ['mastitis', 'Zuchtwert Mastitisresistenz']] as const) {
    const v = input.breedingValues[trait]
    if (t.udderBreedingValue > 0 && v != null && v < t.udderBreedingValue) {
      reasons.push({ area: 'euter', weight: 1, text: `${label} ${v}` })
    }
  }

  if (p?.performance_rel != null && p.performance_rel < t.performanceRel) {
    const pct = Math.round((1 - p.performance_rel) * 100)
    const basis = p.performance_basis === 'Standardlaktation' ? 'Standardlaktation' : 'Lebenstagleistung'
    reasons.push({ area: 'leistung', weight: 1, text: `${basis} ${pct} % unter Gleichaltrigen` })
  }

  const tr = input.trend
  if (tr && t.trendFalling > 0 && tr.fallingStreak >= t.trendFalling) {
    reasons.push({
      area: 'leistung',
      weight: tr.fallingStreak >= t.trendFalling + 1 ? 2 : 1,
      text: `Leistung fällt seit ${tr.fallingStreak} Laktationen (${levelSeries(tr, tr.fallingStreak + 1)} der Herde)`,
    })
  }
  if (tr?.running && tr.running.ownMean != null && t.runningBelowOwn > 0 && tr.running.tests >= 2) {
    const below = Math.round((tr.running.ownMean - tr.running.level) * 100)
    if (below >= t.runningBelowOwn) {
      reasons.push({
        area: 'leistung',
        weight: 1,
        text: `laufende Laktation ${Math.round(tr.running.level * 100)} % der Herde, ${below} Punkte unter dem eigenen Mittel (${Math.round(tr.running.ownMean * 100)} %)`,
      })
    }
  }

  const total = input.species === 'sheep' ? input.breedingValues.gzw : input.breedingValues.iset
  if (total != null && t.totalBreedingValue > 0 && total < t.totalBreedingValue) {
    reasons.push({ area: 'zucht', weight: 1, text: `${input.species === 'sheep' ? 'GZW' : 'ISET'} ${total}` })
  }

  if (input.lactationNumber != null && t.lactationNumber > 0 && input.lactationNumber >= t.lactationNumber) {
    reasons.push({ area: 'alter', weight: 0, text: `${input.lactationNumber}. Laktation` })
  }

  if (t.offspringLossShare > 0 && input.recentOffspring.length >= 2) {
    const lost = input.recentOffspring.filter((o) => o.stillborn || o.died_24h).length
    if (lost / input.recentOffspring.length >= t.offspringLossShare) {
      reasons.push({ area: 'nachkommen', weight: 1, text: `${lost} von ${input.recentOffspring.length} Nachkommen tot (letzte zwei Geburten)` })
    }
  }

  const events = input.healthEvents12m ?? []
  if (t.healthEvents12m > 0 && events.length >= t.healthEvents12m) {
    const diagnoses = [...new Set(events.map((e) => e.diagnosis).filter(Boolean))].slice(0, 3).join(', ')
    reasons.push({
      area: 'gesundheit',
      weight: 2,
      text: `${events.length} Krankheits-/Behandlungstage in 12 Monaten${diagnoses ? ` (${diagnoses})` : ''}`,
    })
  }

  return reasons
}

export function reasonScore(reasons: CullingReason[]): number {
  return reasons.reduce((s, r) => s + r.weight, 0)
}
