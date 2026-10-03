// Laktationsleistung (pages/Milk.tsx, Tab "Laktationsleistung"): Filter,
// Sortierung und Zusammenfassung je Tier — reine Funktionen (getestet).

import { animalLabel } from '@fmis/core/earTag'
import type { AnimalStatus, LactationSummary } from '../types'

export interface LactationRow extends LactationSummary {
  lauf_nr: string | null
  animal_status: AnimalStatus
}

/** Kurzform für die Tabelle; die lange steht im Tooltip. */
export const CLOSURE_SHORT: Record<number, string> = {
  1: 'Teil',
  2: '305 T.',
  3: 'Voll',
  4: '100 T.',
  5: '200 T.',
  6: '305 T.',
  7: 'laufend',
  8: 'laufend',
  9: 'Prognose',
}

export const CLOSURE_LABEL: Record<number, string> = {
  1: 'Teilabschluss',
  2: 'Standardabschluss (305 Tage)',
  3: 'Vollabschluss',
  4: '100-Tage-Abschluss',
  5: '200-Tage-Abschluss',
  6: '305-Tage-Abschluss',
  7: '305-Tage-Abschluss (laufend)',
  8: 'laufend',
  9: 'prognostiziert',
}

export const isRunning = (l: { closure_type: number }) => l.closure_type >= 7

/** F+E je Melktag, in g. */
export function fePerDay(l: { fat_protein_kg: number | null; days_in_milk: number | null }): number | null {
  if (l.fat_protein_kg == null || !l.days_in_milk) return null
  return (l.fat_protein_kg * 1000) / l.days_in_milk
}

export interface LactationFilter {
  search: string
  status: 'alle' | 'laufend' | 'abgeschlossen'
  parity: 'alle' | '1' | '2' | '3+'
  /** Kalbejahr, '' = alle */
  year: string
  activeOnly: boolean
}

export const DEFAULT_FILTER: LactationFilter = { search: '', status: 'alle', parity: 'alle', year: '', activeOnly: true }

export function matchesLactation(l: LactationRow, f: LactationFilter): boolean {
  if (f.activeOnly && l.animal_status !== 'aktiv') return false
  if (f.status === 'laufend' && !isRunning(l)) return false
  if (f.status === 'abgeschlossen' && isRunning(l)) return false
  if (f.parity === '3+' ? l.lactation_number < 3 : f.parity !== 'alle' && l.lactation_number !== Number(f.parity)) return false
  if (f.year && !(l.calving_date ?? '').startsWith(f.year)) return false
  const q = f.search.trim().toLowerCase()
  if (q) {
    const hay = [l.ear_tag, l.name, l.lauf_nr, animalLabel(l)].filter(Boolean).join(' ').toLowerCase().replace(/[.\s]/g, '')
    if (!hay.includes(q.replace(/[.\s]/g, ''))) return false
  }
  return true
}

export function calvingYears(rows: LactationRow[]): string[] {
  return [...new Set(rows.map((r) => r.calving_date?.slice(0, 4)).filter((y): y is string => !!y))].sort().reverse()
}

// --- Ansicht pro Tier ---

export interface AnimalLactations {
  animal_id: string
  label: string
  lauf_nr: string | null
  animal_status: AnimalStatus
  /** Absteigend nach Laktationsnummer (neueste zuerst). */
  lactations: LactationRow[]
  latest: LactationRow
  totalMilk: number
  totalFe: number
  /** Ø F+E der abgeschlossenen Laktationen (ohne laufende). */
  avgFe: number | null
  bestFe: number | null
  /** Lebenstagleistung (lib/herdPerformance.ts), nur aktive weibliche Tiere. */
  ltl?: LifetimeYield
}

export interface LifetimeYield {
  /** kg Milch je Lebenstag */
  milk: number | null
  /** kg F+E je Lebenstag */
  fe: number | null
  /** F+E-Lebenstagleistung relativ zu Herdengenossinnen mit gleich vielen Laktationen (1 = Mittel). */
  feRel: number | null
}

export function groupByAnimal(rows: LactationRow[]): AnimalLactations[] {
  const byAnimal = new Map<string, LactationRow[]>()
  for (const r of rows) byAnimal.set(r.animal_id, [...(byAnimal.get(r.animal_id) ?? []), r])
  return [...byAnimal.values()].map((list) => {
    const lactations = [...list].sort((a, b) => b.lactation_number - a.lactation_number)
    const closedFe = lactations.filter((l) => !isRunning(l) && l.fat_protein_kg != null).map((l) => l.fat_protein_kg!)
    const allFe = lactations.map((l) => l.fat_protein_kg).filter((v): v is number => v != null)
    const first = lactations[0]
    return {
      animal_id: first.animal_id,
      label: animalLabel(first),
      lauf_nr: first.lauf_nr,
      animal_status: first.animal_status,
      lactations,
      latest: first,
      totalMilk: lactations.reduce((s, l) => s + (l.milk_kg ?? 0), 0),
      totalFe: allFe.reduce((s, v) => s + v, 0),
      avgFe: closedFe.length ? closedFe.reduce((s, v) => s + v, 0) / closedFe.length : null,
      bestFe: allFe.length ? Math.max(...allFe) : null,
    }
  })
}

export type AnimalSort = 'lauf_nr' | 'latest_fe' | 'avg_fe' | 'total_fe' | 'ltl_fe' | 'ltl_rel' | 'count'

export const ANIMAL_SORT_LABEL: Record<AnimalSort, string> = {
  lauf_nr: 'Laufnummer / Name',
  latest_fe: 'F+E letzte Laktation',
  avg_fe: 'Ø F+E abgeschlossen',
  total_fe: 'F+E Lebensleistung',
  ltl_fe: 'Lebenstagleistung F+E',
  ltl_rel: 'Lebenstagleistung ggü. Gleichaltrigen',
  count: 'Anzahl Laktationen',
}

function byLabel(a: AnimalLactations, b: AnimalLactations): number {
  const na = Number(a.lauf_nr)
  const nb = Number(b.lauf_nr)
  if (a.lauf_nr && b.lauf_nr && !Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  if (a.lauf_nr && !b.lauf_nr) return -1
  if (!a.lauf_nr && b.lauf_nr) return 1
  return a.label.localeCompare(b.label, 'de-CH', { numeric: true })
}

/** Zahlen absteigend (bester zuerst), fehlende Werte ans Ende. */
export function sortAnimals(list: AnimalLactations[], sort: AnimalSort): AnimalLactations[] {
  const value = (a: AnimalLactations): number | null =>
    sort === 'latest_fe'
      ? a.latest.fat_protein_kg
      : sort === 'avg_fe'
        ? a.avgFe
        : sort === 'total_fe'
          ? a.totalFe
          : sort === 'ltl_fe'
            ? (a.ltl?.fe ?? null)
            : sort === 'ltl_rel'
              ? (a.ltl?.feRel ?? null)
              : a.lactations.length
  return [...list].sort((a, b) => {
    if (sort === 'lauf_nr') return byLabel(a, b)
    const av = value(a)
    const bv = value(b)
    if (av == null && bv == null) return byLabel(a, b)
    if (av == null) return 1
    if (bv == null) return -1
    return bv - av || byLabel(a, b)
  })
}

// --- Ansicht alle Laktationen ---

export type RowSort = 'label' | 'lactation_number' | 'calving_date' | 'days_in_milk' | 'milk_kg' | 'fat_kg' | 'protein_kg' | 'fat_protein_kg' | 'fe_per_day'

export function sortRows(rows: LactationRow[], key: RowSort, desc: boolean): LactationRow[] {
  const value = (r: LactationRow): string | number | null =>
    key === 'label' ? (r.lauf_nr ? r.lauf_nr.padStart(8, '0') : animalLabel(r)) : key === 'fe_per_day' ? fePerDay(r) : r[key]
  return [...rows].sort((a, b) => {
    const av = value(a)
    const bv = value(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = av < bv ? -1 : av > bv ? 1 : b.lactation_number - a.lactation_number
    return desc ? -cmp : cmp
  })
}
