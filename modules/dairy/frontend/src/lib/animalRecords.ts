// Einzelne Erfassungen eines Tiers für die Tierseite (pages/AnimalDetail.tsx), je Zeile korrigierbar:
// Trächtigkeitsbefunde, Gewichte und Absetzen. Gewichte und Absetzen eines Jungtiers hängen oft noch an der
// Geburt (offspring_id, vor der Ohrmarke), darum auch über birth_offspring.animal_key.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { isoDate, num } from './format'
import type { DurationUnit, PregnancyMethod, PregnancyResult } from '../types'

export interface CheckRecord {
  id: string
  check_date: string
  result: PregnancyResult
  method: PregnancyMethod | null
  examiner: string | null
  weeks: number | null
  duration_unit: DurationUnit | null
  notes: string | null
}

export interface WeightRecord {
  id: string
  weigh_date: string
  weight_kg: number
  notes: string | null
}

export interface WeaningRecord {
  id: string
  wean_date: string
  reason: string | null
  herd_group: string | null
  notes: string | null
}

export const WEAN_REASON_LABEL: Record<string, string> = { abgesetzt: 'abgesetzt', weggenommen: 'von der Mutter weggenommen' }

type Row = Record<string, unknown>
const s = (v: unknown) => (v == null ? null : String(v))

/** Einträge eines Jungtiers aus der Geburt (offspring_id): Nachkommen, deren Schlüssel zur Ohrmarke passt. */
async function offspringIdsOf(pg: PGlite, animalId: string): Promise<string[]> {
  const { rows } = await pg.query<{ ear_tag: string }>('select ear_tag from animals where id = $1', [animalId])
  const key = rows[0] ? animalKey(rows[0].ear_tag) : null
  if (!key) return []
  const o = await pg.query<{ id: string }>('select id from birth_offspring where animal_key = $1 and deleted_at is null', [key])
  return o.rows.map((r) => String(r.id))
}

/** Dauer lesbar: «6 Wochen», «40 Tage». */
export function durationText(weeks: number | null, unit: DurationUnit | string | null): string | null {
  if (weeks == null) return null
  if (unit === 'tage') {
    const days = Math.round(weeks * 7)
    return `${days} ${days === 1 ? 'Tag' : 'Tage'}`
  }
  const w = Math.round(weeks * 10) / 10
  return `${w.toLocaleString('de-CH')} ${w === 1 ? 'Woche' : 'Wochen'}`
}

/** Alle Trächtigkeitsbefunde des Tiers, neueste zuerst. */
export async function loadPregnancyChecks(pg: PGlite, animalId: string): Promise<CheckRecord[]> {
  const { rows } = await pg.query<Row>(
    `select id, check_date, result, method, examiner, weeks, duration_unit, notes from pregnancy_checks
     where animal_id = $1 and deleted_at is null order by check_date desc, recorded_at desc`,
    [animalId],
  )
  return rows.map((c) => ({
    id: String(c.id),
    check_date: isoDate(c.check_date)!,
    result: c.result as PregnancyResult,
    method: (c.method as PregnancyMethod | null) ?? null,
    examiner: s(c.examiner),
    weeks: num(c.weeks),
    duration_unit: (c.duration_unit as DurationUnit | null) ?? null,
    notes: s(c.notes),
  }))
}

/** Alle Gewichte des Tiers (auch aus der Zeit vor der Ohrmarke), neueste zuerst. */
export async function loadAnimalWeights(pg: PGlite, animalId: string): Promise<WeightRecord[]> {
  const offspring = await offspringIdsOf(pg, animalId)
  const { rows } = await pg.query<Row>(
    `select id, weigh_date, weight_kg, notes from animal_weights
     where deleted_at is null and (animal_id = $1 or offspring_id = any($2::uuid[]))
     order by weigh_date desc, updated_at desc`,
    [animalId, offspring],
  )
  return rows.map((w) => ({ id: String(w.id), weigh_date: isoDate(w.weigh_date)!, weight_kg: num(w.weight_kg) ?? 0, notes: s(w.notes) }))
}

/** Absetz-Einträge des Tiers (normalerweise einer), neueste zuerst. */
export async function loadAnimalWeanings(pg: PGlite, animalId: string): Promise<WeaningRecord[]> {
  const offspring = await offspringIdsOf(pg, animalId)
  const { rows } = await pg.query<Row>(
    `select id, wean_date, reason, herd_group, notes from weanings
     where deleted_at is null and (animal_id = $1 or offspring_id = any($2::uuid[]))
     order by wean_date desc, updated_at desc`,
    [animalId, offspring],
  )
  return rows.map((w) => ({ id: String(w.id), wean_date: isoDate(w.wean_date)!, reason: s(w.reason), herd_group: s(w.herd_group), notes: s(w.notes) }))
}

/** Gewicht aus einem Eingabefeld («12,5» oder «12.5»), auf 100 g gerundet; null = ungültig. */
export function parseKg(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n < 2000 ? Math.round(n * 10) / 10 : null
}
