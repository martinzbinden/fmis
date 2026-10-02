// Lädt alles, was Tierdetail und Ausmerzliste je Muttertier brauchen, in
// wenigen Abfragen und rechnet die Kennzahlen (Fruchtbarkeit, Leistung im
// Herdenvergleich, Zellzahl, Zuchtwerte). Herdenvergleich nur unter den
// aktiven weiblichen Tieren — wie im bisherigen Selektionsablauf, der nur
// den aktuellen Bestand kannte.

import type { PGlite } from '@electric-sql/pglite'
import { computeFertility, type FertilityStatus, type MatingEvent, type Species } from './fertility'
import { computeHerdPerformance, type PerformanceMetrics } from './herdPerformance'
import { isoDate, num } from './format'
import type { Animal } from '../types'

export interface BreedingValueEntry {
  value: number
  reliability: number | null
  eval_date: string
  base: string | null
}

export interface OffspringRow {
  ear_tag: string | null
  sex: 'w' | 'm' | null
  stillborn: boolean
  died_24h: boolean
  birth_weight_kg: number | null
}

export interface BirthRow {
  id: string
  birth_date: string
  parity: number | null
  sire_key: string | null
  sire_ear_tag: string | null
  sire_name: string | null
  ease: number | null
  source: string
  offspring: OffspringRow[]
}

export interface MatingRow extends MatingEvent {
  id: string
  seq: number | null
  sire_ear_tag: string | null
  source: string
}

export interface AnimalContext {
  animal: Animal
  births: BirthRow[]
  matings: MatingRow[]
  fertility: FertilityStatus
  performance: PerformanceMetrics | undefined
  currentLactationScc: (number | null)[]
  breedingValues: Record<string, BreedingValueEntry>
  lactationNumber: number | null
}

export async function loadHerdContext(pg: PGlite, species: Species, today: string): Promise<Map<string, AnimalContext>> {
  const [animals, lactations, tests, births, offspring, matings, bvs] = await Promise.all([
    pg.query<Animal>('select * from animals where deleted_at is null'),
    pg.query<Record<string, unknown>>(
      'select animal_id, lactation_number, closure_type, milk_kg, fat_kg, protein_kg, days_in_milk, calving_date from lactations where deleted_at is null',
    ),
    pg.query<{ animal_id: string; test_date: unknown; cell_count: unknown }>(
      'select animal_id, test_date, cell_count from milk_tests where deleted_at is null order by test_date',
    ),
    pg.query<Record<string, unknown>>('select * from births where deleted_at is null'),
    pg.query<Record<string, unknown>>('select * from birth_offspring where deleted_at is null'),
    pg.query<Record<string, unknown>>('select * from matings where deleted_at is null'),
    pg.query<Record<string, unknown>>('select * from breeding_values where deleted_at is null order by eval_date'),
  ])

  const byAnimal = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>()
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r])
    return m
  }

  const offspringByBirth = byAnimal(offspring.rows, (r) => String(r.birth_id))
  const birthsByDam = byAnimal(
    births.rows.map((b): BirthRow & { dam_id: string } => ({
      id: String(b.id),
      dam_id: String(b.dam_id),
      birth_date: isoDate(b.birth_date)!,
      parity: num(b.parity),
      sire_key: (b.sire_key as string) ?? null,
      sire_ear_tag: (b.sire_ear_tag as string) ?? null,
      sire_name: (b.sire_name as string) ?? null,
      ease: num(b.ease),
      source: String(b.source),
      offspring: (offspringByBirth.get(String(b.id)) ?? []).map((o) => ({
        ear_tag: (o.ear_tag as string) ?? null,
        sex: (o.sex as 'w' | 'm') ?? null,
        stillborn: Boolean(o.stillborn),
        died_24h: Boolean(o.died_24h),
        birth_weight_kg: num(o.birth_weight_kg),
      })),
    })),
    (b) => b.dam_id,
  )
  const conceptionByBirth = new Map(births.rows.map((b) => [String(b.id), isoDate(b.conception_date)]))
  const matingsByAnimal = byAnimal(
    matings.rows.map((m): MatingRow & { animal_id: string } => ({
      id: String(m.id),
      animal_id: String(m.animal_id),
      service_date: isoDate(m.service_date)!,
      service_to: isoDate(m.service_to),
      kind: (m.kind as MatingEvent['kind']) ?? null,
      seq: num(m.seq),
      sire_key: (m.sire_key as string) ?? null,
      sire_ear_tag: (m.sire_ear_tag as string) ?? null,
      sire_name: (m.sire_name as string) ?? null,
      source: String(m.source),
    })),
    (m) => m.animal_id,
  )
  const lactationsByAnimal = byAnimal(lactations.rows, (l) => String(l.animal_id))
  const testsByAnimal = byAnimal(tests.rows, (t) => t.animal_id)
  const bvByAnimal = new Map<string, Record<string, BreedingValueEntry>>()
  for (const bv of bvs.rows) {
    const rec = bvByAnimal.get(String(bv.animal_id)) ?? {}
    // nach eval_date sortiert geladen — der neueste Wert gewinnt
    rec[String(bv.trait)] = {
      value: num(bv.value)!,
      reliability: num(bv.reliability),
      eval_date: isoDate(bv.eval_date)!,
      base: (bv.base as string) ?? null,
    }
    bvByAnimal.set(String(bv.animal_id), rec)
  }

  const herd = animals.rows.filter((a) => a.status === 'aktiv' && a.sex !== 'm')
  const performance = computeHerdPerformance(
    herd.map((a) => ({
      id: a.id,
      birth_date: isoDate(a.birth_date),
      lactations: (lactationsByAnimal.get(a.id) ?? []).map((l) => ({
        lactation_number: num(l.lactation_number)!,
        closure_type: num(l.closure_type)!,
        milk_kg: num(l.milk_kg),
        fat_kg: num(l.fat_kg),
        protein_kg: num(l.protein_kg),
        days_in_milk: num(l.days_in_milk),
        calving_date: isoDate(l.calving_date),
      })),
      tests: (testsByAnimal.get(a.id) ?? []).map((t) => ({ test_date: isoDate(t.test_date)!, cell_count: num(t.cell_count) })),
    })),
    today,
  )

  const out = new Map<string, AnimalContext>()
  for (const a of animals.rows) {
    const animal = { ...a, birth_date: isoDate(a.birth_date), entry_date: isoDate(a.entry_date), exit_date: isoDate(a.exit_date) }
    const animalBirths = (birthsByDam.get(a.id) ?? []).sort((x, y) => x.birth_date.localeCompare(y.birth_date))
    const animalMatings = (matingsByAnimal.get(a.id) ?? []).sort((x, y) => x.service_date.localeCompare(y.service_date))
    const fertility = computeFertility(
      animalBirths.map((b) => ({ birth_date: b.birth_date, parity: b.parity, conception_date: conceptionByBirth.get(b.id) ?? null })),
      animalMatings,
      species,
      today,
    )
    const lastBirth = fertility.last_birth
    const lactNumbers = (lactationsByAnimal.get(a.id) ?? []).map((l) => num(l.lactation_number) ?? 0)
    const parities = animalBirths.map((b) => b.parity ?? 0)
    const maxLact = Math.max(0, ...lactNumbers, ...parities)
    out.set(a.id, {
      animal,
      births: animalBirths,
      matings: animalMatings,
      fertility,
      performance: performance.get(a.id),
      currentLactationScc: lastBirth
        ? (testsByAnimal.get(a.id) ?? []).filter((t) => (isoDate(t.test_date) ?? '') >= lastBirth).map((t) => num(t.cell_count))
        : [],
      breedingValues: bvByAnimal.get(a.id) ?? {},
      lactationNumber: maxLact || null,
    })
  }
  return out
}

/** Nur die Werte je Merkmal — Eingabe für lib/culling.ts. */
export function latestValues(bvs: Record<string, BreedingValueEntry>): Record<string, number> {
  return Object.fromEntries(Object.entries(bvs).map(([k, v]) => [k, v.value]))
}
