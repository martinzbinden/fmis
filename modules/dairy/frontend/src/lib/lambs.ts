// Lämmer (pages/Lambs.tsx): Alter, Gewichte, saugend oder abgesetzt (schema/0027).
// «Mit Lämmern» ist ein Zustand der Mutter, keine Tiergruppe: Aue und Lämmer können
// in der Melkgruppe stehen und trotzdem als saugend gelten, bis abgesetzt ist.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { daysBetween, isoDate, num } from './format'

/** Absetzen vorschlagen ab diesem Alter (Tage). */
export const WEAN_FROM_DAYS = 40
/** Ohne Absetz-Eintrag gilt ein Jungtier mit bekannter Mutter bis zu diesem Alter als saugend; ältere aus früheren
 * Jahren (Herdebuch) wären sonst ewig «saugend». */
export const NURSING_MAX_DAYS = 120
/** Bis zu diesem Alter steht ein Jungtier in der Lämmerliste. */
export const LAMB_MAX_DAYS = 365

export interface LambInput {
  births: { id: string; dam_id: string; birth_date: string }[]
  offspring: {
    id: string
    birth_id: string
    animal_key: string | null
    sex: 'w' | 'm' | null
    stillborn: boolean
    died_24h: boolean
    died_on: string | null
    birth_weight_kg: number | null
  }[]
  animals: { id: string; ear_tag: string; lauf_nr: string | null; name: string | null; birth_date: string | null; sex: 'w' | 'm' | null; status: string }[]
  weanings: { offspring_id: string | null; animal_id: string | null; wean_date: string }[]
  weights: { offspring_id: string | null; animal_id: string | null; weigh_date: string; weight_kg: number }[]
}

export interface Lamb {
  /** offspring_id, sonst animal_id (Tier ohne erfasste Geburt) */
  key: string
  offspringId: string | null
  animalId: string | null
  earTag: string | null
  lauf_nr: string | null
  name: string | null
  sex: 'w' | 'm' | null
  birthDate: string
  ageDays: number
  damId: string | null
  /** Wurf inkl. toter */
  litter: number
  birthWeight: number | null
  /** älteste zuerst */
  weights: { date: string; kg: number }[]
  /** Tageszunahme in g vom Geburts- (oder ersten) bis zum letzten Gewicht */
  gainPerDay: number | null
  weanDate: string | null
  nursing: boolean
}

export function buildLambs(input: LambInput, today: string): Lamb[] {
  const animalByKey = new Map(input.animals.map((a) => [animalKey(a.ear_tag), a]))
  const birthById = new Map(input.births.map((b) => [b.id, b]))
  const litterSize = new Map<string, number>()
  for (const o of input.offspring) litterSize.set(o.birth_id, (litterSize.get(o.birth_id) ?? 0) + 1)
  const wean = (offspringId: string | null, animalId: string | null) =>
    input.weanings
      .filter((w) => (offspringId && w.offspring_id === offspringId) || (animalId && w.animal_id === animalId))
      .map((w) => w.wean_date)
      .sort()[0] ?? null
  const weighings = (offspringId: string | null, animalId: string | null) =>
    input.weights
      .filter((w) => (offspringId && w.offspring_id === offspringId) || (animalId && w.animal_id === animalId))
      .map((w) => ({ date: w.weigh_date, kg: w.weight_kg }))
      .sort((a, b) => a.date.localeCompare(b.date))

  const out: Lamb[] = []
  const seen = new Set<string>()
  const add = (l: Omit<Lamb, 'ageDays' | 'weights' | 'gainPerDay' | 'weanDate' | 'nursing'>) => {
    const ageDays = daysBetween(l.birthDate, today)
    if (ageDays < 0 || ageDays > LAMB_MAX_DAYS) return
    const weights = weighings(l.offspringId, l.animalId)
    const first = l.birthWeight != null ? { date: l.birthDate, kg: l.birthWeight } : weights[0]
    const last = weights[weights.length - 1]
    const days = first && last ? daysBetween(first.date, last.date) : 0
    const weanDate = wean(l.offspringId, l.animalId)
    out.push({
      ...l,
      ageDays,
      weights,
      gainPerDay: first && last && days > 0 ? Math.round(((last.kg - first.kg) * 1000) / days) : null,
      weanDate,
      // ohne bekannte Mutter (Zukauf) nicht saugend
      nursing: !weanDate && ageDays <= NURSING_MAX_DAYS && l.damId != null,
    })
  }

  for (const o of input.offspring) {
    if (o.stillborn || o.died_24h || o.died_on) continue
    const b = birthById.get(o.birth_id)
    if (!b) continue
    // nur dasselbe Tier, wenn das Geburtsdatum passt (wie beim Nachtragen der Ohrmarke)
    const found = o.animal_key ? animalByKey.get(o.animal_key) : undefined
    const a = found && (!found.birth_date || found.birth_date === b.birth_date) ? found : undefined
    if (a && a.status !== 'aktiv') continue
    if (a) seen.add(a.id)
    add({
      key: o.id,
      offspringId: o.id,
      animalId: a?.id ?? null,
      earTag: a?.ear_tag ?? null,
      lauf_nr: a?.lauf_nr ?? null,
      name: a?.name ?? null,
      sex: o.sex ?? a?.sex ?? null,
      birthDate: b.birth_date,
      damId: b.dam_id,
      litter: litterSize.get(o.birth_id) ?? 1,
      birthWeight: o.birth_weight_kg,
    })
  }
  // Jungtiere ohne erfasste Geburt (z.B. nur aus dem TVD-Bestand)
  for (const a of input.animals) {
    if (seen.has(a.id) || a.status !== 'aktiv' || !a.birth_date) continue
    add({ key: a.id, offspringId: null, animalId: a.id, earTag: a.ear_tag, lauf_nr: a.lauf_nr, name: a.name, sex: a.sex, birthDate: a.birth_date, damId: null, litter: 1, birthWeight: null })
  }
  return out.sort((a, b) => a.birthDate.localeCompare(b.birthDate) || (a.lauf_nr ?? a.earTag ?? '').localeCompare(b.lauf_nr ?? b.earTag ?? '', 'de', { numeric: true }))
}

/** Mütter mit saugenden Lämmern → Anzahl. */
export function nursingByDam(lambs: Lamb[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lambs) if (l.nursing && l.damId) m.set(l.damId, (m.get(l.damId) ?? 0) + 1)
  return m
}

export async function loadLambs(pg: PGlite, today: string): Promise<Lamb[]> {
  const [births, offspring, animals, weanings, weights] = await Promise.all([
    pg.query<Record<string, unknown>>('select id, dam_id, birth_date from births where deleted_at is null'),
    pg.query<Record<string, unknown>>(
      'select id, birth_id, animal_key, sex, stillborn, died_24h, died_on, birth_weight_kg from birth_offspring where deleted_at is null',
    ),
    pg.query<Record<string, unknown>>('select id, ear_tag, lauf_nr, name, birth_date, sex, status from animals where deleted_at is null'),
    pg.query<Record<string, unknown>>('select offspring_id, animal_id, wean_date from weanings where deleted_at is null'),
    pg.query<Record<string, unknown>>('select offspring_id, animal_id, weigh_date, weight_kg from animal_weights where deleted_at is null'),
  ])
  const s = (v: unknown) => (v == null ? null : String(v))
  return buildLambs(
    {
      births: births.rows.map((b) => ({ id: String(b.id), dam_id: String(b.dam_id), birth_date: isoDate(b.birth_date)! })),
      offspring: offspring.rows.map((o) => ({
        id: String(o.id),
        birth_id: String(o.birth_id),
        animal_key: s(o.animal_key),
        sex: (o.sex as 'w' | 'm' | null) ?? null,
        stillborn: Boolean(o.stillborn),
        died_24h: Boolean(o.died_24h),
        died_on: isoDate(o.died_on),
        birth_weight_kg: num(o.birth_weight_kg),
      })),
      animals: animals.rows.map((a) => ({
        id: String(a.id),
        ear_tag: String(a.ear_tag),
        lauf_nr: s(a.lauf_nr),
        name: s(a.name),
        birth_date: isoDate(a.birth_date),
        sex: (a.sex as 'w' | 'm' | null) ?? null,
        status: String(a.status),
      })),
      weanings: weanings.rows.map((w) => ({ offspring_id: s(w.offspring_id), animal_id: s(w.animal_id), wean_date: isoDate(w.wean_date)! })),
      weights: weights.rows.map((w) => ({ offspring_id: s(w.offspring_id), animal_id: s(w.animal_id), weigh_date: isoDate(w.weigh_date)!, weight_kg: num(w.weight_kg)! })),
    },
    today,
  )
}

/** Mütter mit saugenden Lämmern (für Kennzeichen 🍼 und Filter in anderen Listen). */
export async function loadNursingDams(pg: PGlite, today: string): Promise<Map<string, number>> {
  return nursingByDam(await loadLambs(pg, today))
}
