// Daten für den Entscheid gleich nach der Geburt (components/BirthFollowUp.tsx): Leistung und Zuchtwerte
// beider Eltern, die Nachkommen samt bisheriger Vorauswahl.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'
import { TRAIT_LABEL, TRAIT_ORDER, SIRE_TRAIT } from './breedingTraits'
import type { Species } from './fertility'
import { num } from './format'
import { damTrendIndex, lambIndex, type SelectionSettings } from './lambSelection'
import { loadLambSelection } from './lambSelectionData'
import { ABORT_MONTHS, parseDefects } from './lambLoss'
import type { Preselection, RecommendationInput } from './lambRecommendation'
import type { PerformanceMetrics } from './herdPerformance'
import type { LactationTrend } from './lactationTrend'

export interface TraitValue {
  label: string
  value: number
}

export interface SelectionRow {
  id: string
  animal_key: string | null
  offspring_id: string | null
  purpose: 'zucht' | 'mast' | null
  leaning: 'eher_ja' | 'eher_nein' | 'spaeter' | null
  decided_on: unknown
  notes: string | null
}

export interface FollowUpLamb {
  id: string
  ear_tag: string | null
  key: string | null
  sex: 'w' | 'm' | null
  dead: boolean
  loss_cause: string | null
  defects: string[]
  loss_note: string | null
  preselection: Preselection | null
  selection: SelectionRow | null
}

export interface FollowUpParents {
  dam: {
    id: string | null
    ear_tag: string | null
    lauf_nr: string | null
    name: string | null
    performance: PerformanceMetrics | undefined
    trend: LactationTrend | undefined
    index: number | null
    values: TraitValue[]
  }
  sire: {
    key: string | null
    id: string | null
    ear_tag: string | null
    name: string | null
    values: TraitValue[]
    /** Gesamtzuchtwert nur als Elternmittel bekannt */
    fromParents: boolean
  }
  inbreeding: number
  /** Grundlage der Empfehlung, ohne das Geschlecht des Jungtiers */
  basis: Omit<RecommendationInput, 'sex'>
}

const ordered = (byTrait: Map<string, number>): TraitValue[] =>
  TRAIT_ORDER.filter((t) => byTrait.has(t)).map((t) => ({ label: TRAIT_LABEL[t] ?? t, value: byTrait.get(t)! }))

export const preselectionOf = (s: Pick<SelectionRow, 'purpose' | 'leaning'> | null | undefined): Preselection | null => s?.purpose ?? s?.leaning ?? null

/** Eltern: rechnet den Herdenvergleich und dauert darum einen Moment. Einmal laden, nicht bei jeder Änderung. */
export async function loadFollowUpParents(pg: PGlite, species: Species, birthId: string, today: string, settings: SelectionSettings): Promise<FollowUpParents | null> {
  const [birthRes, pedigreeValues, base] = await Promise.all([
    pg.query<Record<string, unknown>>('select * from births where id = $1 and deleted_at is null', [birthId]),
    pg.query<{ animal_key: string; trait: string; value: unknown }>('select animal_key, trait, value from pedigree_breeding_values where deleted_at is null order by eval_date'),
    loadLambSelection(pg, species, today),
  ])
  const birth = birthRes.rows[0]
  if (!birth) return null

  const damCtx = base.context.get(String(birth.dam_id))
  const damKey = damCtx ? animalKey(damCtx.animal.ear_tag) : null
  const perf = damCtx?.performance
  const idxTrend = damKey ? (damTrendIndex(base.dams).get(damKey) ?? null) : null
  const damIndex = perf ? lambIndex(perf.idx_performance, settings.scc12m ? perf.idx_scc_12m : perf.idx_scc, null, { ...settings, weightSire: 0 }, idxTrend) : null

  const sireKey = (birth.sire_key as string | null) ?? null
  const sireCtx = sireKey ? [...base.context.values()].find((c) => animalKey(c.animal.ear_tag) === sireKey) : undefined
  const sireTraits = new Map<string, number>()
  for (const r of pedigreeValues.rows) if (r.animal_key === sireKey && num(r.value) != null) sireTraits.set(r.trait, num(r.value)!)
  for (const [t, v] of Object.entries(sireCtx?.breedingValues ?? {})) sireTraits.set(t, v.value)
  const mainTrait = SIRE_TRAIT[species].trait
  const fromParents = !sireTraits.has(mainTrait) && !!sireKey && base.sireValueBasis.get(sireKey) === 'eltern'
  if (fromParents) sireTraits.set(mainTrait, base.sireValues.get(sireKey!)!)
  const damTraits = new Map(Object.entries(damCtx?.breedingValues ?? {}).map(([t, v]) => [t, v.value]))
  const inbreeding = base.inbreeding.offspring(damKey, sireKey)

  return {
    dam: {
      id: damCtx?.animal.id ?? null,
      ear_tag: damCtx?.animal.ear_tag ?? null,
      lauf_nr: damCtx?.animal.lauf_nr ?? null,
      name: damCtx?.animal.name ?? null,
      performance: perf,
      trend: damKey ? base.dams.get(damKey)?.trend : undefined,
      index: damIndex,
      values: ordered(damTraits),
    },
    sire: {
      key: sireKey,
      id: sireCtx?.animal.id ?? null,
      ear_tag: (birth.sire_ear_tag as string | null) ?? sireKey,
      name: (birth.sire_name as string | null) ?? sireCtx?.animal.name ?? null,
      values: ordered(sireTraits),
      fromParents,
    },
    inbreeding,
    basis: { damIndex, damBasis: perf?.data_basis ?? null, damValue: damTraits.get(mainTrait) ?? null, sireValue: sireTraits.get(mainTrait) ?? null, inbreeding },
  }
}

/** Nachkommen samt Vorauswahl: schnell, wird nach jeder Änderung neu gelesen. */
export async function loadFollowUpLambs(pg: PGlite, birthId: string, today: string): Promise<{ lambs: FollowUpLamb[]; abortsRecent: number }> {
  const [offspringRes, selectionRes, abortRes] = await Promise.all([
    pg.query<Record<string, unknown>>('select * from birth_offspring where birth_id = $1 and deleted_at is null order by import_key', [birthId]),
    pg.query<SelectionRow>('select * from lamb_selection where deleted_at is null order by updated_at'),
    pg.query<{ n: unknown }>(
      `select count(*) as n from birth_offspring o join births b on b.id = o.birth_id
       where o.deleted_at is null and b.deleted_at is null and o.loss_cause = 'abort' and b.birth_date >= $1::date - interval '${ABORT_MONTHS} months'`,
      [today],
    ),
  ])
  // neueste Zeile gewinnt (aufsteigend geladen)
  const byOffspring = new Map<string, SelectionRow>()
  const byKey = new Map<string, SelectionRow>()
  for (const s of selectionRes.rows) {
    if (s.offspring_id) byOffspring.set(s.offspring_id, s)
    if (s.animal_key) byKey.set(s.animal_key, s)
  }
  const lambs = offspringRes.rows.map((o) => {
    const key = (o.animal_key as string | null) ?? animalKey(o.ear_tag as string | null)
    const selection = byOffspring.get(String(o.id)) ?? (key ? byKey.get(key) : undefined) ?? null
    return {
      id: String(o.id),
      ear_tag: (o.ear_tag as string | null) ?? null,
      key,
      sex: (o.sex as 'w' | 'm' | null) ?? null,
      dead: !!(o.stillborn || o.died_24h || o.died_on),
      loss_cause: (o.loss_cause as string | null) ?? null,
      defects: parseDefects(o.defects as string | null),
      loss_note: (o.loss_note as string | null) ?? null,
      preselection: preselectionOf(selection),
      selection,
    }
  })
  return { lambs, abortsRecent: Number(abortRes.rows[0]?.n ?? 0) }
}

/** Vorauswahl speichern, null nimmt sie zurück. Zucht und Mast sind der endgültige Entscheid wie auf
 * der Selektionsseite, der Rest bleibt vorläufig. rowId: dieselbe Zeile, auch bei schnellem Umtippen. */
export async function savePreselection(pg: PGlite, lamb: FollowUpLamb, rowId: string, next: Preselection | null, today: string): Promise<void> {
  const purpose = next === 'zucht' || next === 'mast' ? next : null
  await upsertRow(pg, 'lamb_selection', {
    id: rowId,
    animal_key: lamb.key,
    offspring_id: lamb.id,
    purpose,
    leaning: next && !purpose ? next : null,
    decided_on: purpose ? today : null,
    notes: lamb.selection?.notes ?? null,
  })
}

/** Ursache eines toten Jungtiers. */
export async function saveLoss(pg: PGlite, offspringId: string, patch: { loss_cause?: string | null; defects?: string | null; loss_note?: string | null }): Promise<void> {
  const { rows } = await pg.query<Record<string, unknown>>('select * from birth_offspring where id = $1', [offspringId])
  if (!rows[0]) throw new Error('Nachkomme nicht gefunden.')
  await upsertRow(pg, 'birth_offspring', { ...rows[0], id: offspringId, ...patch })
}

