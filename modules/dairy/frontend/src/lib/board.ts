// Dashboard (pages/Board.tsx): jedes Tier eine Karte, Spalten = Tiergruppen und Merklisten.
// Hier die Daten der Karten, die Felder für eigene Filter, die mitgelieferten Filter und die Spalten.

import type { AnimalRef } from '@fmis/core/animals'
import { shortEarTag } from '@fmis/core/earTag'
import type { FieldDef, FilterDef } from '@fmis/core/filters/filterModel'
import { presetFilter } from '@fmis/core/filters/useSavedFilters'
import { cullingReasons, reasonScore, type CullingReason, type CullingThresholds } from './culling'
import type { Species } from './fertility'
import { cullingInput, type AnimalContext, type SccLevel } from './herdContext'
import type { LactationLevel, TrendDirection } from './lactationTrend'
import type { DamMilk } from './lambMilk'
import type { BreedingEstimate } from './breedingEstimate'
import { speciesTerms } from './species'
import { daysBetween } from './format'
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
  /** Anzahl saugende Lämmer/Kälber (bei der Mutter, nicht am Eimer) */
  nursing: number
  /** Lämmer am Eimer: bei der Mutter, nicht abgesetzt, saugen aber nicht */
  bucketLambs?: number
  // Fortpflanzung
  pregnancy: PregnancyStatus | null
  expectedBirth: string | null
  /** letzte Belegung (KB oder Natursprung, bei Bockzeit mit Ende `to`), auch vor der letzten Geburt; null ohne */
  lastService?: { date: string; to: string | null; kind: 'kb' | 'natursprung' | null; sire: string | null; daysAgo: number } | null
  /** Belegungen seit der letzten Geburt (ohne Geburt: alle) */
  servicesSinceBirth?: number
  lastBirth: string | null
  daysSinceBirth: number | null
  parity: number | null
  lactationNumber: number | null
  litterMean: number | null
  lastLitterSize: number | null
  /** letzter Wurf: lebend geboren / tot oder vor dem Markieren verendet (null ohne Geburt) */
  litterAlive: number | null
  litterDead: number | null
  // Leistung
  ltlMilk: number | null
  performanceRel: number | null
  idxPerformance: number | null
  scc12m: number | null
  /** Zellzahl-Index im Herdenvergleich (Mittel 100; Ø 12 Monate, sonst Laktation) */
  idxScc: number | null
  /** Zellzahl Ø 12 Monate in % des Mittels der Gleichaltrigen (gleiche Laktationsgruppe); tiefer ist besser */
  sccRelPeers: number | null
  /** Leistungsniveau je Laktation gegen die Herde (1.0 = Herdenmittel), für die Minigrafik */
  levels: LactationLevel[]
  /** Zellzahl je Laktation (geometrisches Mittel, Tsd./ml) für die rote Linie in der Minigrafik */
  sccLevels: SccLevel[]
  /** Tendenz über die Laktationen (ab 2 bewerteten Laktationen, sonst null) */
  trend: TrendDirection | null
  /** offizielle Milchprüfungen (mit Gehalten, SMG) der laufenden Laktation; private Wägungen zählen nicht */
  weighings: number
  /** Beginn der laufenden Laktation (letzte Geburt oder Abkalbedatum der Milchprüfung, das spätere) */
  lactationStart?: string | null
  /** Zellzahl der letzten Prüfung dieser Laktation (Tsd./ml) mit Datum; null ohne */
  lastScc?: { value: number; date: string } | null
  /** mittlere Tage zwischen zwei Geburten (ab 2 Geburten) */
  intervalDays: number | null
  /** geschätzte Milch der Lämmer des letzten Wurfs (lib/lambMilk.ts); null ohne Lämmer */
  lambMilk: DamMilk | null
  breedingValue: number | null
  /** Zuchtwert aus der Abstammung geschätzt (nur ohne eigenen Wert; nie mit `breedingValue` vermischt) */
  breedingEstimate: BreedingEstimate | null
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
  /** Mutter → Lämmer am Eimer */
  bucket?: ReadonlyMap<string, number>
  lambMilk?: ReadonlyMap<string, DamMilk>
  breedingEstimates?: ReadonlyMap<string, BreedingEstimate>
  breedingTrait: string
}

/** Karten aller aktiven Tiere; Reihenfolge wie `refs`. */
export function buildCards(input: BoardInput): BoardCard[] {
  const lists = new Map<string, string[]>()
  for (const e of input.entries) {
    if (e.done_at) continue
    lists.set(e.animal_id, [...(lists.get(e.animal_id) ?? []), e.list_id])
  }
  // Zellzahl Ø 12 Monate: Mittel je Laktationsgruppe (Gleichaltrige) für den Vergleich
  const sccByGroup = new Map<number, number[]>()
  for (const c of input.context.values()) {
    const p = c.performance
    if (p?.scc_geo_12m != null && c.animal.status === 'aktiv') sccByGroup.set(p.lactation_group, [...(sccByGroup.get(p.lactation_group) ?? []), p.scc_geo_12m])
  }
  const sccPeerMean = (g: number): number | null => {
    const v = sccByGroup.get(g)
    return v && v.length >= 3 ? v.reduce((s, x) => s + x, 0) / v.length : null
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
      bucketLambs: input.bucket?.get(ref.id) ?? 0,
      pregnancy: ctx.pregnancy,
      expectedBirth: ctx.fertility.expected_birth,
      lastService: (() => {
        const m = ctx.matings.at(-1)
        return m ? { date: m.service_date, to: m.service_to, kind: m.kind, sire: m.sire_name || m.sire_ear_tag || null, daysAgo: daysBetween(m.service_to && m.service_to < input.today ? m.service_to : m.service_date, input.today) } : null
      })(),
      servicesSinceBirth: ctx.fertility.services_since_birth,
      lastBirth: ctx.fertility.last_birth,
      daysSinceBirth: ctx.fertility.days_since_birth,
      parity: ref.parity,
      lactationNumber: ctx.lactationNumber,
      litterMean: ctx.births.length ? litterMeanOf(ctx) : null,
      lastLitterSize: lastBirth && lastBirth.offspring.length ? lastBirth.offspring.length : null,
      litterAlive: lastBirth && lastBirth.offspring.length ? lastBirth.offspring.filter((o) => !isDead(o)).length : null,
      litterDead: lastBirth && lastBirth.offspring.length ? lastBirth.offspring.filter(isDead).length : null,
      ltlMilk: ctx.performance?.ltl_milk ?? null,
      performanceRel: ctx.performance?.performance_rel_stage ?? ctx.performance?.performance_rel ?? null,
      idxPerformance: ctx.performance?.idx_performance ?? null,
      scc12m: ctx.performance?.scc_geo_12m ?? null,
      idxScc: ctx.performance?.idx_scc_12m ?? ctx.performance?.idx_scc ?? null,
      sccRelPeers: (() => {
        const p = ctx.performance
        const mean = p ? sccPeerMean(p.lactation_group) : null
        return p?.scc_geo_12m != null && mean ? Math.round((p.scc_geo_12m / mean) * 100) : null
      })(),
      levels: ctx.trend?.levels ?? [],
      sccLevels: ctx.sccByLactation,
      trend: ctx.trend?.direction ?? null,
      weighings: ctx.lactationTests.filter((t) => t.lab).length,
      lactationStart: ctx.lactationStart,
      lastScc: (() => {
        const t = [...ctx.lactationTests].reverse().find((x) => x.scc != null)
        return t ? { value: t.scc!, date: t.date } : null
      })(),
      intervalDays: birthInterval(ctx),
      lambMilk: input.lambMilk?.get(ref.id) ?? null,
      breedingEstimate: input.breedingEstimates?.get(ref.id) ?? null,
      breedingValue: ctx.breedingValues[input.breedingTrait]?.value ?? null,
      reasons,
      reasonScore: reasonScore(reasons),
      healthDays12m: ctx.healthEvents12m.length,
    })
  }
  return cards
}

const isDead = (o: { stillborn: boolean; died_24h: boolean; died_on: string | null }) => o.stillborn || o.died_24h || !!o.died_on

/** Erfolgreich abgesetzte Lämmer des letzten Wurfs: lebend geboren und nicht (mehr) saugend. Verkaufte oder
 * geschlachtete zählen mit, sie haben die Aufzucht geschafft. */
export function weanedOfLastLitter(c: Pick<BoardCard, 'litterAlive' | 'nursing' | 'bucketLambs'>): number {
  return c.litterAlive == null ? 0 : Math.max(0, c.litterAlive - c.nursing - (c.bucketLambs ?? 0))
}

/** Mittlere Tage zwischen aufeinanderfolgenden Geburten; null unter 2 Geburten. */
export function birthInterval(ctx: Pick<AnimalContext, 'births'>): number | null {
  const dates = ctx.births.map((b) => Date.parse(`${b.birth_date}T00:00:00Z`)).sort((a, b) => a - b)
  if (dates.length < 2) return null
  return Math.round((dates[dates.length - 1] - dates[0]) / (dates.length - 1) / 86_400_000)
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

export type SortKey = 'nr' | 'age' | 'birth' | 'expected' | 'service' | 'score' | 'lambValue'

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'nr', label: 'Nummer' },
  { key: 'age', label: 'Alter (älteste zuerst)' },
  { key: 'birth', label: 'Letzte Geburt (jüngste zuerst)' },
  { key: 'expected', label: 'Erwartete Geburt (früheste zuerst)' },
  { key: 'service', label: 'Letzte Belegung (jüngste zuerst)' },
  { key: 'score', label: 'Ausmerz-Punkte (meiste zuerst)' },
  { key: 'lambValue', label: 'Zucht-Mehrwert Jungtiere (höchster zuerst)' },
]

const collator = new Intl.Collator('de', { numeric: true })
const byNr = (a: BoardCard, b: BoardCard) => collator.compare(a.laufNr ?? '￿', b.laufNr ?? '￿') || collator.compare(a.earTag, b.earTag)
/** Unbekannte Werte kommen immer ans Ende. */
const nullsLast = <T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : cmp(a, b))

/** `lambValue`: Zucht-Mehrwert in Fr. je Karte (lib/lambValue.ts), ohne Wert ans Ende */
export function sortCards(cards: BoardCard[], key: SortKey, lambValue?: (c: BoardCard) => number | null): BoardCard[] {
  const out = [...cards]
  switch (key) {
    case 'lambValue':
      return out.sort((a, b) => nullsLast(lambValue?.(a) ?? null, lambValue?.(b) ?? null, (x, y) => y - x) || byNr(a, b))
    case 'age':
      return out.sort((a, b) => nullsLast(a.ageMonths, b.ageMonths, (x, y) => y - x) || byNr(a, b))
    case 'birth':
      return out.sort((a, b) => nullsLast(a.lastBirth, b.lastBirth, (x, y) => y.localeCompare(x)) || byNr(a, b))
    case 'expected':
      return out.sort((a, b) => nullsLast(a.expectedBirth, b.expectedBirth, (x, y) => x.localeCompare(y)) || byNr(a, b))
    case 'service':
      return out.sort((a, b) => nullsLast(a.lastService?.date ?? null, b.lastService?.date ?? null, (x, y) => y.localeCompare(x)) || byNr(a, b))
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

export type BreedingBadge = { kind: 'belegt' | 'traechtig' | 'leer' | 'unsicher'; days: number | null; title: string }

/** Badge auf der Karte, immer sichtbar: belegt (♥ Tage seit der Meldung) oder Trächtigkeitsstatus (trächtig mit
 * Tagen seit der Meldung, leer, unsicher). Zählt nur, was seit der letzten Geburt gemeldet ist; ein «leer» vor einer
 * neueren Belegung gilt nicht mehr. */
export function breedingBadge(c: Pick<BoardCard, 'lastService' | 'lastBirth' | 'pregnancy'>, today: string): BreedingBadge | null {
  const m = c.lastService && (!c.lastBirth || c.lastService.date > c.lastBirth) ? c.lastService : null
  const p = c.pregnancy
  const days = m ? daysBetween(m.date, today) : null
  const mated = m ? `belegt ${m.date.slice(8, 10)}.${m.date.slice(5, 7)}.${m.date.slice(0, 4)}${m.sire ? ` mit ${m.sire}` : ''}, vor ${days} Tagen` : 'keine Belegung gemeldet'
  const checked = p ? `Trächtigkeit ${p.result} am ${p.date.slice(8, 10)}.${p.date.slice(5, 7)}.${p.date.slice(0, 4)}` : ''
  const after = p && (!m || p.date >= m.date)
  if (p?.result === 'ja') return { kind: 'traechtig', days, title: `trächtig (${checked}); ${mated}` }
  if (after && p?.result === 'nein') return { kind: 'leer', days: null, title: `${checked}; ${mated}` }
  if (after && p?.result === 'unsicher') return { kind: 'unsicher', days, title: `${checked}; ${mated}` }
  if (m) return { kind: 'belegt', days, title: `${mated}${p ? ` (${checked}, vor der Belegung)` : ''}` }
  return null
}
