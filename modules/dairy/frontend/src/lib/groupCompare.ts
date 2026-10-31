// Gruppen vergleichen (pages/GroupCompare.tsx): beliebige Gruppen (Merklisten oder feste
// Auswahlen wie «alle Mütter») nebeneinander nach Leistung + Zuchtwert, Schlachterlös-Prognose
// (Alter, Laktationsphase) und Fortpflanzung, dazu Klauengesundheit.

import { SIRE_TRAIT } from './breedingTraits'
import type { ClawStatus } from './clawHealth'
import type { Species } from './fertility'
import { litterSummary, type AnimalContext } from './herdContext'
import type { LambRow } from './lambSelection'

export interface GroupSettings {
  /** Jungtiere (Lamm/Kalb), CHF je kg Schlachtgewicht */
  priceYoung: number | null
  /** ausgewachsene Tiere, CHF je kg Schlachtgewicht */
  priceAdult: number | null
  /** Schlachtgewicht Jungtier ab Mindestalter, kg */
  carcassYoung: number | null
  /** Schlachtgewicht ausgewachsenes Tier, kg */
  carcassAdult: number | null
  /** Jungtier schlachtreif ab, Monate */
  minAgeMonths: number
  /** zählt als Jungtier bis zu diesem Alter (Tage, exklusive) */
  youngMaxDays: number
}

/** Schafe: Preise und Lamm-Gewicht wie «Lämmer zum Schlachttermin»; Gewicht der Auen offen. */
export const DEFAULT_GROUP_SETTINGS: Record<Species, GroupSettings> = {
  sheep: { priceYoung: 13.4, priceAdult: 6.4, carcassYoung: 22, carcassAdult: null, minAgeMonths: 8, youngMaxDays: 420 },
  cattle: { priceYoung: null, priceAdult: null, carcassYoung: null, carcassAdult: null, minAgeMonths: 8, youngMaxDays: 420 },
}

const DAY = 86_400_000
const DAYS_PER_MONTH = 30.4375
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)

export interface AnimalMetrics {
  id: string
  ageMonths: number | null
  lactationNumber: number | null
  // Leistung + Zuchtwert
  idxPerformance: number | null
  idxScc: number | null
  performanceRel: number | null
  ltlMilk: number | null
  scc12m: number | null
  breedingValue: number | null
  lambIndex: number | null
  sireValue: number | null
  // Schlachterlös-Prognose
  young: boolean
  daysSinceBirth: number | null
  pregnant: boolean
  revenue: number | null
  // Fortpflanzung
  interval: number | null
  firstService: number | null
  servicesPerConception: number | null
  litterMean: number | null
  expectedBirth: string | null
  // Klauen
  mh: number | null
  lame: boolean | null
  clawAffected12m: number | null
}

export function slaughterRevenue(birthDate: string | null, today: string, s: GroupSettings): { young: boolean; revenue: number | null } {
  if (!birthDate) return { young: false, revenue: null }
  const age = days(birthDate, today)
  const young = age < s.youngMaxDays
  if (young) {
    if (age < Math.ceil(s.minAgeMonths * DAYS_PER_MONTH) || s.priceYoung == null || s.carcassYoung == null) return { young, revenue: null }
    return { young, revenue: Math.round(s.priceYoung * s.carcassYoung * 100) / 100 }
  }
  if (s.priceAdult == null || s.carcassAdult == null) return { young, revenue: null }
  return { young, revenue: Math.round(s.priceAdult * s.carcassAdult * 100) / 100 }
}

export function animalMetrics(
  ctx: AnimalContext,
  species: Species,
  today: string,
  s: GroupSettings,
  lamb: LambRow | undefined,
  claw: ClawStatus | undefined,
): AnimalMetrics {
  const p = ctx.performance
  const f = ctx.fertility
  const { young, revenue } = slaughterRevenue(ctx.animal.birth_date, today, s)
  return {
    id: ctx.animal.id,
    ageMonths: ctx.ageMonths,
    lactationNumber: ctx.lactationNumber,
    idxPerformance: p?.idx_performance ?? null,
    idxScc: p?.idx_scc ?? null,
    performanceRel: p?.performance_rel_stage ?? p?.performance_rel ?? null,
    ltlMilk: p?.ltl_milk ?? null,
    scc12m: p?.scc_geo_12m ?? null,
    breedingValue: ctx.breedingValues[SIRE_TRAIT[species].trait]?.value ?? null,
    lambIndex: lamb?.index ?? null,
    sireValue: lamb?.sire_value ?? null,
    young,
    daysSinceBirth: f.last_birth ? days(f.last_birth, today) : null,
    pregnant: ctx.pregnancy?.result === 'ja',
    revenue,
    interval: f.mean_interval,
    firstService: f.mean_first_service,
    servicesPerConception: f.services_per_conception,
    litterMean: litterSummary(ctx.births).mean,
    expectedBirth: f.expected_birth,
    mh: claw?.mh ?? null,
    lame: claw ? claw.lame : null,
    clawAffected12m: claw ? claw.affected12m : null,
  }
}

type NumKey = { [K in keyof AnimalMetrics]: AnimalMetrics[K] extends number | null ? K : never }[keyof AnimalMetrics]

export interface MetricDef {
  section: 'Leistung + Zuchtwert' | 'Schlachterlös-Prognose' | 'Fortpflanzung' | 'Klauen'
  label: string
  /** Wert je Gruppe aus den Tieren */
  value: (ms: AnimalMetrics[]) => { value: number | null; n: number }
  fmt: (v: number) => string
  /** besser ist höher/tiefer (für die Hervorhebung), null = neutral */
  better: 'high' | 'low' | null
}

function mean(ms: AnimalMetrics[], key: NumKey) {
  const xs = ms.map((m) => m[key] as number | null).filter((x): x is number => x != null)
  return { value: xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null, n: xs.length }
}
function share(ms: AnimalMetrics[], pred: (m: AnimalMetrics) => boolean | null) {
  const known = ms.map(pred).filter((x): x is boolean => x != null)
  return { value: known.length ? known.filter(Boolean).length / known.length : null, n: known.length }
}
function sum(ms: AnimalMetrics[], key: NumKey) {
  const xs = ms.map((m) => m[key] as number | null).filter((x): x is number => x != null)
  return { value: xs.length ? xs.reduce((s, x) => s + x, 0) : null, n: xs.length }
}

const f0 = (v: number) => String(Math.round(v))
const f1 = (v: number) => v.toFixed(1)
const pct = (v: number) => `${Math.round(v * 100)} %`
const chf = (v: number) => `${Math.round(v).toLocaleString('de-CH')}`

export function metricDefs(species: Species): MetricDef[] {
  const bv = SIRE_TRAIT[species].label
  const birth = species === 'sheep' ? 'Ablammung' : 'Abkalbung'
  const interval = species === 'sheep' ? 'ZLZ' : 'ZKZ'
  return [
    { section: 'Leistung + Zuchtwert', label: 'Index Leistung', value: (ms) => mean(ms, 'idxPerformance'), fmt: f0, better: 'high' },
    { section: 'Leistung + Zuchtwert', label: 'Index Zellzahl', value: (ms) => mean(ms, 'idxScc'), fmt: f0, better: 'high' },
    { section: 'Leistung + Zuchtwert', label: 'Leistung ggü. Gleichaltrigen', value: (ms) => mean(ms, 'performanceRel'), fmt: pct, better: 'high' },
    { section: 'Leistung + Zuchtwert', label: 'Lebenstagleistung kg', value: (ms) => mean(ms, 'ltlMilk'), fmt: (v) => v.toFixed(2), better: 'high' },
    { section: 'Leistung + Zuchtwert', label: 'Zellzahl Ø 12 Mt. (1000/ml)', value: (ms) => mean(ms, 'scc12m'), fmt: f0, better: 'low' },
    { section: 'Leistung + Zuchtwert', label: `Zuchtwert ${bv}`, value: (ms) => mean(ms, 'breedingValue'), fmt: f0, better: 'high' },
    { section: 'Leistung + Zuchtwert', label: 'Index Abstammung (Jungtiere)', value: (ms) => mean(ms, 'lambIndex'), fmt: f0, better: 'high' },
    { section: 'Leistung + Zuchtwert', label: `Vater ${bv} (Jungtiere)`, value: (ms) => mean(ms, 'sireValue'), fmt: f0, better: 'high' },
    { section: 'Schlachterlös-Prognose', label: 'Alter (Monate)', value: (ms) => mean(ms, 'ageMonths'), fmt: f0, better: null },
    { section: 'Schlachterlös-Prognose', label: 'Laktation Nr.', value: (ms) => mean(ms, 'lactationNumber'), fmt: f1, better: null },
    { section: 'Schlachterlös-Prognose', label: `Tage seit ${birth}`, value: (ms) => mean(ms, 'daysSinceBirth'), fmt: f0, better: null },
    { section: 'Schlachterlös-Prognose', label: 'Anteil trächtig gemeldet', value: (ms) => share(ms, (m) => m.pregnant), fmt: pct, better: null },
    { section: 'Schlachterlös-Prognose', label: 'Erlös je Tier CHF', value: (ms) => mean(ms, 'revenue'), fmt: chf, better: null },
    { section: 'Schlachterlös-Prognose', label: 'Erlös total CHF', value: (ms) => sum(ms, 'revenue'), fmt: chf, better: null },
    { section: 'Fortpflanzung', label: `Ø ${interval} (Tage)`, value: (ms) => mean(ms, 'interval'), fmt: f0, better: 'low' },
    { section: 'Fortpflanzung', label: 'Ø Rastzeit (Tage)', value: (ms) => mean(ms, 'firstService'), fmt: f0, better: 'low' },
    { section: 'Fortpflanzung', label: 'Belegungen je Trächtigkeit', value: (ms) => mean(ms, 'servicesPerConception'), fmt: f1, better: 'low' },
    ...(species === 'sheep' ? [{ section: 'Fortpflanzung' as const, label: 'Wurfgrösse Ø', value: (ms: AnimalMetrics[]) => mean(ms, 'litterMean'), fmt: f1, better: 'high' as const }] : []),
    ...(species === 'sheep'
      ? [{ section: 'Klauen' as const, label: 'Moderhinke-Score Ø', value: (ms: AnimalMetrics[]) => mean(ms, 'mh'), fmt: f1, better: 'low' as const }]
      : []),
    { section: 'Klauen', label: 'Anteil lahm', value: (ms) => share(ms, (m) => m.lame), fmt: pct, better: 'low' },
    { section: 'Klauen', label: 'Befunde 12 Mt. je Tier', value: (ms) => mean(ms, 'clawAffected12m'), fmt: f1, better: 'low' },
  ]
}

/** Index der besten Gruppe je Kennzahl (nur bei mindestens zwei Werten). */
export function bestIndex(values: (number | null)[], better: 'high' | 'low' | null): number | null {
  if (!better) return null
  const known = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null)
  if (known.length < 2) return null
  const best = known.reduce((a, b) => ((better === 'high' ? b.v > a.v : b.v < a.v) ? b : a))
  return known.filter((x) => x.v === best.v).length > 1 ? null : best.i
}
