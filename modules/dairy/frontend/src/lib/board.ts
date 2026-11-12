// Dashboard (pages/Board.tsx): jedes Tier eine Karte, Spalten = Tiergruppen und Merklisten.
// Hier die Daten der Karten, die Felder für eigene Filter, die mitgelieferten Filter und die Spalten.

import type { AnimalRef } from '@fmis/core/animals'
import { shortEarTag } from '@fmis/core/earTag'
import type { FieldDef, FilterDef } from '@fmis/core/filters/filterModel'
import { presetFilter } from '@fmis/core/filters/useSavedFilters'
import { cullingReasons, reasonScore, type CullingReason, type CullingThresholds } from './culling'
import type { Species } from './fertility'
import { cullingInput, type AnimalContext } from './herdContext'
import { speciesTerms } from './species'
import type { PregnancyStatus } from './pregnancy'
import type { Watchlist, WatchlistEntry } from './watchlists'

export interface BoardCard {
  id: string
  laufNr: string | null
  /** ganze Ohrmarke (ID-Nummer) */
  earTag: string
  shortTag: string
  name: string | null
  sex: 'w' | 'm' | 'k' | null
  birthDate: string | null
  ageMonths: number | null
  /** heutige Tiergruppe (Modul Tiere) */
  groupId: string | null
  listIds: string[]
  dry: boolean
  /** Anzahl saugende Lämmer/Kälber */
  nursing: number
  // Fortpflanzung
  pregnancy: PregnancyStatus | null
  expectedBirth: string | null
  lastBirth: string | null
  daysSinceBirth: number | null
  parity: number | null
  lactationNumber: number | null
  litterMean: number | null
  lastLitterSize: number | null
  // Leistung
  ltlMilk: number | null
  performanceRel: number | null
  idxPerformance: number | null
  scc12m: number | null
  breedingValue: number | null
  // Ausmerzen und Gesundheit
  reasons: CullingReason[]
  reasonScore: number
  healthDays12m: number
}

export interface BoardInput {
  species: Species
  today: string
  thresholds: CullingThresholds
  context: Map<string, AnimalContext>
  refs: AnimalRef[]
  /** Tier-ID → Gruppen-ID */
  groupOf: ReadonlyMap<string, string>
  entries: WatchlistEntry[]
  nursing: ReadonlyMap<string, number>
  breedingTrait: string
}

/** Karten aller aktiven Tiere; Reihenfolge wie `refs`. */
export function buildCards(input: BoardInput): BoardCard[] {
  const lists = new Map<string, string[]>()
  for (const e of input.entries) {
    if (e.done_at) continue
    lists.set(e.animal_id, [...(lists.get(e.animal_id) ?? []), e.list_id])
  }
  const cards: BoardCard[] = []
  for (const ref of input.refs) {
    const ctx = input.context.get(ref.id)
    if (!ctx) continue
    const reasons = cullingReasons(cullingInput(ctx, input.species), input.thresholds)
    const lastBirth = ctx.births.length ? ctx.births[ctx.births.length - 1] : null
    cards.push({
      id: ref.id,
      laufNr: ref.lauf_nr,
      earTag: ref.ear_tag,
      shortTag: shortEarTag(ref.ear_tag),
      name: ref.name,
      sex: ref.sex,
      birthDate: ref.birth_date,
      ageMonths: ctx.ageMonths,
      groupId: input.groupOf.get(ref.id) ?? null,
      listIds: lists.get(ref.id) ?? [],
      dry: !!ref.dry,
      nursing: input.nursing.get(ref.id) ?? 0,
      pregnancy: ctx.pregnancy,
      expectedBirth: ctx.fertility.expected_birth,
      lastBirth: ctx.fertility.last_birth,
      daysSinceBirth: ctx.fertility.days_since_birth,
      parity: ref.parity,
      lactationNumber: ctx.lactationNumber,
      litterMean: ctx.births.length ? litterMeanOf(ctx) : null,
      lastLitterSize: lastBirth && lastBirth.offspring.length ? lastBirth.offspring.length : null,
      ltlMilk: ctx.performance?.ltl_milk ?? null,
      performanceRel: ctx.performance?.performance_rel_stage ?? ctx.performance?.performance_rel ?? null,
      idxPerformance: ctx.performance?.idx_performance ?? null,
      scc12m: ctx.performance?.scc_geo_12m ?? null,
      breedingValue: ctx.breedingValues[input.breedingTrait]?.value ?? null,
      reasons,
      reasonScore: reasonScore(reasons),
      healthDays12m: ctx.healthEvents12m.length,
    })
  }
  return cards
}

function litterMeanOf(ctx: AnimalContext): number | null {
  const sizes = ctx.births.map((b) => b.offspring.length).filter((n) => n > 0)
  return sizes.length ? sizes.reduce((s, x) => s + x, 0) / sizes.length : null
}

/** Trächtigkeit als Auswahlwert: ja/nein/unsicher, «keine» = seit der letzten Geburt nicht untersucht. */
export const pregnancyValue = (c: BoardCard): string => c.pregnancy?.result ?? 'keine'

export const SEX_LABEL: Record<string, string> = { w: 'weiblich', m: 'männlich', k: 'kastriert' }

const AREA_LABEL: Record<string, string> = {
  fruchtbarkeit: 'Fruchtbarkeit',
  euter: 'Euter',
  leistung: 'Leistung',
  zucht: 'Zucht',
  alter: 'Alter',
  nachkommen: 'Nachkommen',
  gesundheit: 'Gesundheit',
}
export const areaLabel = (a: string) => AREA_LABEL[a] ?? a

export interface BoardRefs {
  groups: { id: string; name: string }[]
  lists: { id: string; name: string }[]
}

/** Felder für eigene Filter. Gruppen und Merklisten kommen aus den Daten. */
export function boardFields(moduleKey: string, species: Species, refs: BoardRefs): FieldDef<BoardCard>[] {
  const terms = speciesTerms(moduleKey)
  const sheep = species === 'sheep'
  const nr = (c: BoardCard) => [c.laufNr, c.shortTag, c.earTag, c.name].filter(Boolean).join(' ')
  return [
    { key: 'nr', label: 'Nummer / Name', type: 'text', group: 'Tier', get: nr },
    { key: 'sex', label: 'Geschlecht', type: 'choice', group: 'Tier', options: Object.entries(SEX_LABEL).map(([value, label]) => ({ value, label })), get: (c) => c.sex },
    { key: 'age', label: 'Alter', type: 'number', unit: 'Monate', group: 'Tier', get: (c) => c.ageMonths },
    { key: 'birth', label: 'Geburtsdatum', type: 'date', group: 'Tier', get: (c) => c.birthDate },
    { key: 'group', label: 'Tiergruppe', type: 'choice', group: 'Zuordnung', options: [{ value: 'none', label: 'ohne Gruppe' }, ...refs.groups.map((g) => ({ value: g.id, label: g.name }))], get: (c) => c.groupId ?? 'none' },
    { key: 'list', label: 'Merkliste', type: 'choice', group: 'Zuordnung', options: refs.lists.map((l) => ({ value: l.id, label: l.name })), get: (c) => c.listIds },
    { key: 'dry', label: 'Trocken', type: 'bool', group: 'Zuordnung', get: (c) => c.dry },
    {
      key: 'pregnancy',
      label: 'Trächtigkeit',
      type: 'choice',
      group: 'Fortpflanzung',
      options: [
        { value: 'ja', label: 'trächtig' },
        { value: 'nein', label: 'leer' },
        { value: 'unsicher', label: 'unsicher' },
        { value: 'keine', label: 'nicht untersucht' },
      ],
      get: pregnancyValue,
    },
    { key: 'expected', label: 'Erwartete Geburt', type: 'date', group: 'Fortpflanzung', get: (c) => c.expectedBirth },
    { key: 'lastBirth', label: `Letzte ${terms.calving}`, type: 'date', group: 'Fortpflanzung', get: (c) => c.lastBirth },
    { key: 'daysSince', label: `Tage seit ${terms.calving}`, type: 'number', unit: 'Tage', group: 'Fortpflanzung', get: (c) => c.daysSinceBirth },
    { key: 'parity', label: sheep ? 'Anzahl Ablammungen' : 'Anzahl Abkalbungen', type: 'number', group: 'Fortpflanzung', get: (c) => c.parity },
    ...(sheep
      ? ([
          { key: 'nursing', label: 'Mit saugenden Lämmern', type: 'bool', group: 'Fortpflanzung', get: (c: BoardCard) => c.nursing > 0 },
          { key: 'litter', label: 'Wurfgrösse Ø', type: 'number', group: 'Fortpflanzung', get: (c: BoardCard) => c.litterMean },
        ] satisfies FieldDef<BoardCard>[])
      : ([{ key: 'nursing', label: 'Mit saugenden Kälbern', type: 'bool', group: 'Fortpflanzung', get: (c: BoardCard) => c.nursing > 0 }] satisfies FieldDef<BoardCard>[])),
    { key: 'lactation', label: 'Laktation Nr.', type: 'number', group: 'Leistung', get: (c) => c.lactationNumber },
    { key: 'rel', label: 'Leistung ggü. Gleichaltrigen', type: 'number', unit: '%', group: 'Leistung', get: (c) => c.performanceRel },
    { key: 'ltl', label: 'Lebenstagleistung', type: 'number', unit: 'kg', group: 'Leistung', get: (c) => c.ltlMilk },
    { key: 'scc', label: 'Zellzahl Ø 12 Mt.', type: 'number', unit: '1000/ml', group: 'Leistung', get: (c) => c.scc12m },
    { key: 'bv', label: sheep ? 'Zuchtwert GZW' : 'Zuchtwert', type: 'number', group: 'Leistung', get: (c) => c.breedingValue },
    { key: 'reasons', label: 'Anzahl Ausmerzgründe', type: 'number', group: 'Ausmerzen / Gesundheit', get: (c) => c.reasons.length },
    { key: 'score', label: 'Ausmerz-Punkte', type: 'number', group: 'Ausmerzen / Gesundheit', get: (c) => c.reasonScore },
    {
      key: 'area',
      label: 'Ausmerzgrund aus Bereich',
      type: 'choice',
      group: 'Ausmerzen / Gesundheit',
      options: Object.entries(AREA_LABEL).map(([value, label]) => ({ value, label })),
      get: (c) => [...new Set(c.reasons.map((r) => r.area))],
    },
    { key: 'health', label: 'Behandlungstage letzte 12 Mt.', type: 'number', group: 'Ausmerzen / Gesundheit', get: (c) => c.healthDays12m },
  ]
}

/** Mitgelieferte Filter (nicht änderbar, aber kopierbar). */
export function boardPresets(species: Species): FilterDef[] {
  const sheep = species === 'sheep'
  return [
    presetFilter('p-pregnant', 'Trächtig', 'blau', 'all', [{ field: 'pregnancy', op: 'is', values: ['ja'] }]),
    presetFilter('p-empty', 'Leer', 'orange', 'all', [{ field: 'pregnancy', op: 'is', values: ['nein'] }]),
    presetFilter('p-soon', 'Geburt in 30 Tagen', 'violett', 'all', [{ field: 'expected', op: 'next_days', value: '30' }]),
    presetFilter('p-nursing', sheep ? 'Mit Lämmern' : 'Mit Kälbern', 'gruen', 'all', [{ field: 'nursing', op: 'yes' }]),
    presetFilter('p-dry', 'Trocken', 'grau', 'all', [{ field: 'dry', op: 'yes' }]),
    presetFilter('p-cull', 'Ausmerzgründe', 'rot', 'all', [{ field: 'reasons', op: 'ge', value: '1' }]),
    presetFilter('p-old', sheep ? 'Über 6 Jahre' : 'Über 8 Jahre', 'gelb', 'all', [{ field: 'age', op: 'gt', value: sheep ? '72' : '96' }]),
    presetFilter('p-unchecked', 'Nicht untersucht', 'rosa', 'all', [
      { field: 'pregnancy', op: 'is', values: ['keine'] },
      { field: 'sex', op: 'is', values: ['w'] },
    ]),
  ]
}

export type SortKey = 'nr' | 'age' | 'birth' | 'expected' | 'score'

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'nr', label: 'Nummer' },
  { key: 'age', label: 'Alter (älteste zuerst)' },
  { key: 'birth', label: 'Letzte Geburt (jüngste zuerst)' },
  { key: 'expected', label: 'Erwartete Geburt (früheste zuerst)' },
  { key: 'score', label: 'Ausmerz-Punkte (meiste zuerst)' },
]

const collator = new Intl.Collator('de', { numeric: true })
const byNr = (a: BoardCard, b: BoardCard) => collator.compare(a.laufNr ?? '￿', b.laufNr ?? '￿') || collator.compare(a.earTag, b.earTag)
/** Unbekannte Werte kommen immer ans Ende. */
const nullsLast = <T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : cmp(a, b))

export function sortCards(cards: BoardCard[], key: SortKey): BoardCard[] {
  const out = [...cards]
  switch (key) {
    case 'age':
      return out.sort((a, b) => nullsLast(a.ageMonths, b.ageMonths, (x, y) => y - x) || byNr(a, b))
    case 'birth':
      return out.sort((a, b) => nullsLast(a.lastBirth, b.lastBirth, (x, y) => y.localeCompare(x)) || byNr(a, b))
    case 'expected':
      return out.sort((a, b) => nullsLast(a.expectedBirth, b.expectedBirth, (x, y) => x.localeCompare(y)) || byNr(a, b))
    case 'score':
      return out.sort((a, b) => b.reasonScore - a.reasonScore || byNr(a, b))
    default:
      return out.sort(byNr)
  }
}

export interface BoardColumn {
  /** `g:<id>` Tiergruppe, `g:none` ohne Gruppe, `l:<id>` Merkliste */
  key: string
  kind: 'group' | 'list'
  /** Gruppen-ID, Listen-ID oder null (ohne Gruppe) */
  id: string | null
  title: string
  color: string | null
}

export const columnKey = (kind: 'group' | 'list', id: string | null) => `${kind === 'group' ? 'g' : 'l'}:${id ?? 'none'}`

export function buildColumns(groups: { id: string; name: string }[], lists: Watchlist[]): BoardColumn[] {
  return [
    ...groups.map((g): BoardColumn => ({ key: columnKey('group', g.id), kind: 'group', id: g.id, title: g.name, color: null })),
    { key: columnKey('group', null), kind: 'group', id: null, title: 'Ohne Gruppe', color: null },
    ...lists.filter((l) => !l.archived_at).map((l): BoardColumn => ({ key: columnKey('list', l.id), kind: 'list', id: l.id, title: l.name, color: l.color })),
  ]
}

/** Karten einer Spalte. `groupOf` ist die Gruppe mit Entwurf. */
export function cardsInColumn(col: BoardColumn, cards: BoardCard[], groupOf: (id: string) => string | null): BoardCard[] {
  return col.kind === 'group' ? cards.filter((c) => groupOf(c.id) === col.id) : cards.filter((c) => c.listIds.includes(col.id!))
}
