// Daten für den Schlachtwert Rindvieh (lib/carcassValue.ts): Tiere mit Rasse und Abstammung, eigene Schätzungen,
// Wägungen, Proviande-Wochenpreise und die früheren Schlachtabrechnungen (Modul Mastplaner, slaughter_records) zum
// Anpassen der Wachstumskurve.

import { useEffect, useState } from 'react'
import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { getSyncedDb as getLivestockDb } from '@fmis/livestock/db/access'
import { latestProviande } from '@fmis/livestock/lib/proviande'
import { daysBetween, isoDate } from './format'
import { breedMature, calibrate, carcassYield, cattleCategory, FALLBACK_CATTLE_PRICES, type Calibration, type CattleInput, type ChtaxObs, type FatClass, type Fleshiness, type PriceTable, type Sex, type WeightObs } from './carcassValue'

export interface EstimateRow {
  id: string
  animal_id: string
  estimate_date: string
  kind: 'gewicht' | 'chtax'
  method: 'messband' | 'auge' | null
  basis: 'lg' | 'sg' | null
  weight_kg: number | null
  girth_cm: number | null
  fleshiness: Fleshiness | null
  fat_class: FatClass | null
  notes: string | null
  created_by: string | null
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

export async function loadEstimates(pg: PGlite, animalId?: string): Promise<EstimateRow[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    `select * from carcass_estimates where deleted_at is null ${animalId ? 'and animal_id = $1' : ''} order by estimate_date desc, updated_at desc`,
    animalId ? [animalId] : [],
  )
  return rows.map((r) => ({
    id: String(r.id),
    animal_id: String(r.animal_id),
    estimate_date: isoDate(r.estimate_date) ?? '',
    kind: r.kind as EstimateRow['kind'],
    method: (r.method as EstimateRow['method']) ?? null,
    basis: (r.basis as EstimateRow['basis']) ?? null,
    weight_kg: num(r.weight_kg),
    girth_cm: num(r.girth_cm),
    fleshiness: (r.fleshiness as Fleshiness | null) ?? null,
    fat_class: (num(r.fat_class) as FatClass | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
  }))
}

/** Schätzung → Beobachtung für die Rechnung (Messband: Lebendgewicht aus dem Brustumfang, gespeichert in weight_kg). */
export function toObs(rows: EstimateRow[], scale: { date: string; kg: number }[]): { weights: WeightObs[]; chtax: ChtaxObs[] } {
  const weights: WeightObs[] = scale.map((w) => ({ date: w.date, method: 'waage', liveKg: w.kg }))
  const chtax: ChtaxObs[] = []
  for (const r of rows) {
    if (r.kind === 'chtax' && r.fleshiness && r.fat_class) chtax.push({ date: r.estimate_date, fleshiness: r.fleshiness, fat: r.fat_class })
    if (r.kind === 'gewicht' && r.method && r.weight_kg) weights.push(r.basis === 'sg' ? { date: r.estimate_date, method: r.method, carcassKg: r.weight_kg } : { date: r.estimate_date, method: r.method, liveKg: r.weight_kg })
  }
  return { weights, chtax }
}

export interface CattleData {
  inputs: Map<string, CattleInput>
  calibration: Calibration
}

/** Eingaben aller Tiere (auch abgegangene, für die Abrechnungen) und Anpassung an die Abrechnungen. */
export async function loadCattleData(pg: PGlite, prices: PriceTable): Promise<CattleData> {
  const [animals, calved, pedigree, scale, estimates] = await Promise.all([
    pg.query<Record<string, unknown>>('select id, ear_tag, breed_code, birth_date, sex from animals where deleted_at is null').then((r) => r.rows),
    pg.query<{ dam_id: string }>('select distinct dam_id from births where deleted_at is null').then((r) => new Set(r.rows.map((x) => x.dam_id))),
    pg.query<{ animal_key: string; sire_key: string | null; dam_key: string | null; breed_code: string | null }>('select animal_key, sire_key, dam_key, breed_code from pedigree where deleted_at is null').then((r) => new Map(r.rows.map((x) => [x.animal_key, x]))),
    pg.query<Record<string, unknown>>('select animal_id, weigh_date, weight_kg from animal_weights where deleted_at is null and animal_id is not null').then((r) => r.rows),
    loadEstimates(pg),
  ])
  const scaleBy = new Map<string, { date: string; kg: number }[]>()
  for (const w of scale) {
    const id = String(w.animal_id)
    scaleBy.set(id, [...(scaleBy.get(id) ?? []), { date: isoDate(w.weigh_date) ?? '', kg: Number(w.weight_kg) }])
  }
  const estBy = new Map<string, EstimateRow[]>()
  for (const e of estimates) estBy.set(e.animal_id, [...(estBy.get(e.animal_id) ?? []), e])

  const inputs = new Map<string, CattleInput>()
  const byKey = new Map<string, CattleInput>()
  for (const a of animals) {
    const id = String(a.id)
    const key = animalKey(String(a.ear_tag)) ?? String(a.ear_tag)
    const ped = pedigree.get(key)
    const obs = toObs(estBy.get(id) ?? [], scaleBy.get(id) ?? [])
    const input: CattleInput = {
      birthDate: isoDate(a.birth_date),
      sex: (a.sex as Sex) ?? null,
      calved: calved.has(id),
      breed: (a.breed_code as string | null) ?? ped?.breed_code ?? null,
      sireBreed: ped?.sire_key ? (pedigree.get(ped.sire_key)?.breed_code ?? null) : null,
      damBreed: ped?.dam_key ? (pedigree.get(ped.dam_key)?.breed_code ?? null) : null,
      ...obs,
    }
    inputs.set(id, input)
    byKey.set(key, input)
  }
  return { inputs, calibration: await loadCalibration(byKey, prices) }
}

/** Frühere Abrechnungen (Kalb, Rind, Kuh) mit Schlachtgewicht, über die Ohrmarke mit den eigenen Tieren verknüpft. */
async function loadCalibration(byKey: Map<string, CattleInput>, prices: PriceTable): Promise<Calibration> {
  try {
    const lv = await getLivestockDb()
    const { rows } = await lv.query<Record<string, unknown>>(
      "select slaughter_date, animal_key, carcass_kg from slaughter_records where deleted_at is null and category in ('Kalb', 'Rind', 'Kuh') and carcass_kg > 0 and animal_key is not null",
    )
    const recs = rows.flatMap((r) => {
      const a = byKey.get(String(r.animal_key))
      const date = isoDate(r.slaughter_date)
      if (!a?.birthDate || !date) return []
      const ageDays = daysBetween(a.birthDate, date)
      const cat = cattleCategory(a.sex, ageDays, a.calved)
      return [{ carcassKg: Number(r.carcass_kg), ageDays, sex: a.sex, calved: a.calved, mature: breedMature(a.breed, a.sireBreed, a.damBreed).kg, yieldPct: carcassYield(cat, 'T', prices) }]
    })
    return calibrate(recs)
  } catch {
    // ohne Recht auf den Mastplaner: ohne Anpassung
    return { calf: null, adult: null }
  }
}

/** Proviande-Wochenpreise Rindvieh (alle Kategorien und Fleischigkeiten); bis sie geladen sind, die Ersatztabelle. */
export function useCattlePrices(): { prices: PriceTable; week: string | null } {
  const [state, setState] = useState<{ prices: PriceTable; week: string | null }>({ prices: FALLBACK_CATTLE_PRICES, week: null })
  useEffect(() => {
    let live = true
    const load = () =>
      latestProviande().then((w) => {
        if (live && w && Object.keys(w.prices).some((k) => k.startsWith('VK '))) setState({ prices: w.prices, week: w.week })
      })
    void load()
    // beim ersten Öffnen kommen die Preise erst mit dem Abgleich des Mastplaners
    const t = setTimeout(() => void load(), 15_000)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [])
  return state
}
