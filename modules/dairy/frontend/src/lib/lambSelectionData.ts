// Lädt Jungtiere, Mütter (mit Leistungskennzahlen), Väter-Zuchtwerte,
// Stammbaum und die bisherigen Entscheide für die Selektionsseite.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'
import type { Species } from './fertility'
import { isoDate, num } from './format'
import { loadHerdContext } from './herdContext'
import { loadInbreeding } from './pedigreeData'
import { SIRE_TRAIT } from './breedingTraits'
import type { Inbreeding } from './inbreeding'
import type { DamInfo, LambCandidate, Purpose } from './lambSelection'
import type { Animal } from '../types'

export interface LambSelectionData {
  candidates: LambCandidate[]
  dams: Map<string, DamInfo>
  sireValues: Map<string, number>
  /** Herkunft des Vater-Zuchtwerts: eigener ZW oder Elternmittel (Pedigree-Index). */
  sireValueBasis: Map<string, 'eigen' | 'eltern'>
  decisions: Map<string, { id: string; purpose: Purpose | null; decided_on: string | null; notes: string | null }>
  inbreeding: Inbreeding
}

export { SIRE_TRAIT }

export async function loadLambSelection(pg: PGlite, species: Species, today: string): Promise<LambSelectionData> {
  const [context, births, offspring, pedigree, decisions, inbreeding, externalValues] = await Promise.all([
    loadHerdContext(pg, species, today),
    pg.query<Record<string, unknown>>('select id, dam_id, birth_date, sire_key from births where deleted_at is null'),
    pg.query<Record<string, unknown>>('select birth_id, ear_tag, animal_key, sex, stillborn, died_24h, birth_weight_kg from birth_offspring where deleted_at is null'),
    pg.query<{ animal_key: string; sire_key: string | null; dam_key: string | null }>(
      'select animal_key, sire_key, dam_key from pedigree where deleted_at is null',
    ),
    pg.query<Record<string, unknown>>('select * from lamb_selection where deleted_at is null order by updated_at'),
    loadInbreeding(pg),
    pg.query<{ animal_key: string; value: unknown }>(
      'select animal_key, value from pedigree_breeding_values where deleted_at is null and trait = $1 order by eval_date',
      [SIRE_TRAIT[species].trait],
    ),
  ])

  const dams = new Map<string, DamInfo>()
  const sireValues = new Map<string, number>()
  const animalsByKey = new Map<string, Animal>()
  for (const ctx of context.values()) {
    const key = animalKey(ctx.animal.ear_tag)
    if (!key) continue
    animalsByKey.set(key, ctx.animal)
    dams.set(key, { id: ctx.animal.id, ear_tag: ctx.animal.ear_tag, name: ctx.animal.name, lauf_nr: ctx.animal.lauf_nr, performance: ctx.performance, trend: ctx.trend })
    const bv = ctx.breedingValues[SIRE_TRAIT[species].trait]
    if (bv) sireValues.set(key, bv.value)
  }
  // Tiere ausserhalb des Bestands (Leistungsausweis-PDF); eigene K09-Werte haben Vorrang.
  for (const r of externalValues.rows) if (!sireValues.has(r.animal_key) && num(r.value) != null) sireValues.set(r.animal_key, num(r.value)!)
  const animalKeyById = new Map([...context.values()].map((c) => [c.animal.id, animalKey(c.animal.ear_tag)]))

  // 1. Geburten (Erfassung in FMIS und Herdebuch-Export K11): lebende Nachkommen mit Ohrmarke.
  const litterSize = new Map<string, number>()
  for (const o of offspring.rows) litterSize.set(String(o.birth_id), (litterSize.get(String(o.birth_id)) ?? 0) + 1)
  const birthById = new Map(births.rows.map((b) => [String(b.id), b]))
  const candidates = new Map<string, LambCandidate>()
  for (const o of offspring.rows) {
    const key = (o.animal_key as string | null) ?? animalKey(o.ear_tag as string | null)
    const b = birthById.get(String(o.birth_id))
    if (!key || !b || o.stillborn || o.died_24h) continue
    const animal = animalsByKey.get(key)
    if (animal && animal.status !== 'aktiv') continue
    candidates.set(key, {
      key,
      ear_tag: animal?.ear_tag ?? String(o.ear_tag),
      name: animal?.name ?? null,
      animal_id: animal?.id ?? null,
      birth_date: isoDate(b.birth_date)!,
      sex: (o.sex as 'w' | 'm' | null) ?? animal?.sex ?? null,
      dam_key: animalKeyById.get(String(b.dam_id)) ?? null,
      sire_key: (b.sire_key as string | null) ?? null,
      litter_size: litterSize.get(String(o.birth_id)) ?? null,
      birth_weight_kg: num(o.birth_weight_kg),
    })
  }

  // 2. Übrige Jungtiere im Bestand (z.B. aus dem TVD-Tierbestand), Eltern aus dem Stammbaum.
  const pedigreeByKey = new Map(pedigree.rows.map((p) => [p.animal_key, p]))
  for (const ctx of context.values()) {
    const a = ctx.animal
    const key = animalKey(a.ear_tag)
    if (!key || candidates.has(key) || !a.birth_date || a.status !== 'aktiv') continue
    // Tiere mit eigener Laktation sind keine Jungtiere mehr.
    if (ctx.lactationNumber) continue
    const p = pedigreeByKey.get(key)
    candidates.set(key, {
      key,
      ear_tag: a.ear_tag,
      name: a.name,
      animal_id: a.id,
      birth_date: a.birth_date,
      sex: a.sex,
      dam_key: p?.dam_key ?? null,
      sire_key: p?.sire_key ?? null,
      litter_size: null,
      birth_weight_kg: null,
    })
  }

  // Neueste Zeile je Tier gewinnt (aufsteigend nach updated_at geladen).
  const decisionMap: LambSelectionData['decisions'] = new Map()
  for (const d of decisions.rows) {
    decisionMap.set(String(d.animal_key), {
      id: String(d.id),
      purpose: (d.purpose as Purpose | null) ?? null,
      decided_on: isoDate(d.decided_on),
      notes: (d.notes as string | null) ?? null,
    })
  }

  // Väter ohne eigenen Zuchtwert (junge Widder): Elternmittel, wenn beide
  // Eltern bewertet sind — der übliche Pedigree-Index.
  const sireValueBasis = new Map<string, 'eigen' | 'eltern'>([...sireValues.keys()].map((k) => [k, 'eigen']))
  for (const sireKey of new Set([...candidates.values()].map((c) => c.sire_key))) {
    if (!sireKey || sireValues.has(sireKey)) continue
    const p = pedigreeByKey.get(sireKey)
    const a = p?.sire_key ? sireValues.get(p.sire_key) : undefined
    const b = p?.dam_key ? sireValues.get(p.dam_key) : undefined
    if (a == null || b == null || sireValueBasis.get(p!.sire_key!) !== 'eigen' || sireValueBasis.get(p!.dam_key!) !== 'eigen') continue
    sireValues.set(sireKey, Math.round(((a + b) / 2) * 10) / 10)
    sireValueBasis.set(sireKey, 'eltern')
  }

  return { candidates: [...candidates.values()], dams, sireValues, sireValueBasis, decisions: decisionMap, inbreeding }
}

/** Entscheid speichern bzw. zurücknehmen (purpose null) — immer dieselbe
 * Zeile je Tier, damit kein Verlauf aus Einzelzeilen entsteht. */
export async function saveDecision(
  pg: PGlite,
  key: string,
  purpose: Purpose | null,
  existing: { id: string; notes: string | null } | undefined,
  today: string,
): Promise<void> {
  await upsertRow(pg, 'lamb_selection', {
    id: existing?.id ?? crypto.randomUUID(),
    animal_key: key,
    purpose,
    decided_on: purpose ? today : null,
    notes: existing?.notes ?? null,
  })
}
