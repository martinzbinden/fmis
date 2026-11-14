// Texteingabe im Dashboard (pages/Board.tsx): neben Nummer oder Name auch Bedingungen wie «ZZ > 200» (Zellzahl über 200 Tsd.),
// «Alter > 6 J», «leer», «Gruppe = galt». Die Engine (Zerlegen, Auswerten, Vorschläge) liegt in core/frontend/src/query/engine.ts;
// hier stehen die Felder der Dashboard-Karten. Mehrere Bedingungen trennt «und», «&» oder «;».

import { describeCondition, matchesQuery as engineMatches, norm, parseQuery as engineParse, suggest as engineSuggest, type ParsedQuery, type QueryField } from '@fmis/core/query/engine'
import type { QueryPreset } from '@fmis/core/query/presets'
import { weanedOfLastLitter, type BoardCard } from './board'

export interface QueryContext {
  /** heute (ISO) */
  today: string
  groupName: (card: BoardCard) => string | null
  listNames: (card: BoardCard) => string[]
  /** geschätzter Fleischwert nach Abzügen (null = unbekannt) */
  meat?: (card: BoardCard) => number | null
}

const none = <T,>(v: T | null | undefined) => (v == null ? null : v)

export const QUERY_FIELDS: QueryField<BoardCard, QueryContext>[] = [
  { kind: 'num', key: 'zz', label: 'Zellzahl Ø 12 Monate', unit: 'Tsd./ml', aliases: ['zz', 'zellzahl', 'zellen', 'scc'], example: 'ZZ > 200', get: (c) => none(c.scc12m), normalize: (v) => (v >= 5000 ? v / 1000 : v) },
  { kind: 'num', key: 'zzidx', label: 'Zellzahl-Index (Herde)', unit: '', aliases: ['zzindex', 'zellzahlindex', 'indexzz', 'indexzellzahl'], example: 'Index ZZ < 95', get: (c) => none(c.idxScc) },
  { kind: 'num', key: 'zzgl', label: 'Zellzahl in % der Gleichaltrigen', unit: '%', aliases: ['zzgleichaltrige', 'zellzahlgleichaltrige', 'zzgl'], example: 'ZZ Gleichaltrige > 150', get: (c) => none(c.sccRelPeers) },
  { kind: 'num', key: 'milch', label: 'Milch-Index (Herde)', unit: '', aliases: ['indexmilch', 'milchindex', 'leistungsindex', 'milchidx'], example: 'Index Milch < 95', get: (c) => none(c.idxPerformance) },
  { kind: 'num', key: 'milchgl', label: 'Milch in % der Gleichaltrigen', unit: '%', aliases: ['milchgleichaltrige', 'leistunggleichaltrige', 'leistung', 'milchgl'], example: 'Leistung < 90', get: (c) => (c.performanceRel == null ? null : c.performanceRel * 100) },
  { kind: 'num', key: 'lakt', label: 'Laktationsnummer', unit: '', aliases: ['laktation', 'lakt'], example: 'Laktation >= 3', get: (c) => none(c.lactationNumber) },
  { kind: 'num', key: 'abl', label: 'Anzahl Ablammungen / Abkalbungen', unit: '', aliases: ['ablammungen', 'ablammung', 'abkalbungen', 'geburten', 'abl'], example: 'Ablammungen >= 4', get: (c) => none(c.parity) },
  {
    kind: 'num',
    key: 'alter',
    label: 'Alter',
    unit: 'Jahre',
    aliases: ['alter'],
    example: 'Alter > 6 J',
    get: (c) => (c.ageMonths == null ? null : c.ageMonths / 12),
    units: { j: 1, jahr: 1, jahre: 1, m: 1 / 12, mt: 1 / 12, monat: 1 / 12, monate: 1 / 12, t: 1 / 365.25, tag: 1 / 365.25, tage: 1 / 365.25 },
    defaultUnit: 'j',
  },
  { kind: 'num', key: 'tageabl', label: 'Tage seit der letzten Geburt', unit: 'Tage', aliases: ['tageseitablammung', 'tageseitgeburt', 'tageseitabkalbung', 'laktationstag', 'tsa'], example: 'Tage seit Ablammung > 60', get: (c) => none(c.daysSinceBirth) },
  {
    kind: 'num',
    key: 'tagebisgeburt',
    label: 'Tage bis zur erwarteten Geburt',
    unit: 'Tage',
    aliases: ['tagebisgeburt', 'tagebisablammung', 'tagebisabkalbung', 'geburtin', 'tbg'],
    example: 'Tage bis Geburt <= 30',
    get: (c, ctx) => (c.expectedBirth ? Math.round((Date.parse(`${c.expectedBirth.slice(0, 10)}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 86_400_000) : null),
  },
  { kind: 'num', key: 'wurf', label: 'Letzter Wurf (Anzahl)', unit: '', aliases: ['wurf', 'letzterwurf', 'wurfgroesse'], example: 'Wurf >= 3', get: (c) => none(c.lastLitterSize) },
  { kind: 'num', key: 'wurfmittel', label: 'Wurfgrösse Ø', unit: '', aliases: ['wurfmittel', 'wurfschnitt'], example: 'Wurfmittel > 2', get: (c) => none(c.litterMean) },
  { kind: 'num', key: 'zw', label: 'Zuchtwert (eigener, sonst Schätzung)', unit: '', aliases: ['zuchtwert', 'zw', 'gzw', 'iset'], example: 'Zuchtwert > 105', get: (c) => c.breedingValue ?? c.breedingEstimate?.value ?? null },
  { kind: 'num', key: 'ltl', label: 'Lebenstagleistung', unit: 'kg', aliases: ['lebenstagleistung', 'ltl'], example: 'LTL > 1', get: (c) => none(c.ltlMilk) },
  { kind: 'num', key: 'zwz', label: 'Zwischenablammzeit', unit: 'Tage', aliases: ['zwischenablammzeit', 'zwischenzeit', 'zwischenkalbezeit', 'zwz'], example: 'Zwischenzeit > 400', get: (c) => none(c.intervalDays) },
  { kind: 'num', key: 'saugend', label: 'Saugende Lämmer / Kälber', unit: 'Anzahl', aliases: ['saugend', 'saugende', 'laemmer', 'kaelber'], example: 'Lämmer >= 2', get: (c) => c.nursing },
  { kind: 'num', key: 'abgesetzt', label: 'Abgesetzte Lämmer letzter Wurf', unit: 'Anzahl', aliases: ['abgesetzt', 'abgesetzte'], example: 'Abgesetzt >= 2', get: (c) => weanedOfLastLitter(c) },
  { kind: 'num', key: 'gruende', label: 'Anzahl Ausmerzgründe', unit: '', aliases: ['ausmerzgruende', 'gruende', 'ausmerzen'], example: 'Gründe >= 2', get: (c) => c.reasons.length },
  { kind: 'num', key: 'behandlung', label: 'Behandlungstage 12 Monate', unit: 'Tage', aliases: ['behandlungstage', 'behandlungen'], example: 'Behandlungstage > 0', get: (c) => c.healthDays12m },
  { kind: 'num', key: 'lambmilch', label: 'Milch der Lämmer', unit: 'kg/Tag', aliases: ['laemmermilch', 'lambmilch'], example: 'Lämmermilch > 1.5', get: (c) => (c.lambMilk && c.lambMilk.lambs > 0 ? c.lambMilk.perDay : null) },
  { kind: 'num', key: 'fleisch', label: 'Geschätzter Fleischwert', unit: 'Fr.', aliases: ['fleischwert', 'fleisch', 'fw'], example: 'Fleischwert > 150', get: (c, ctx) => ctx.meat?.(c) ?? null },
  { kind: 'flag', key: 'leer', label: 'leer (nicht trächtig)', aliases: ['leer', 'nichttraechtig'], test: (c) => c.pregnancy?.result === 'nein' },
  { kind: 'flag', key: 'traechtig', label: 'trächtig', aliases: ['traechtig', 'tragend'], test: (c) => c.pregnancy?.result === 'ja' },
  { kind: 'flag', key: 'unsicher', label: 'Trächtigkeit unsicher', aliases: ['unsicher'], test: (c) => c.pregnancy?.result === 'unsicher' },
  { kind: 'flag', key: 'nichtuntersucht', label: 'nicht untersucht', aliases: ['nichtuntersucht', 'ununtersucht'], test: (c) => c.pregnancy == null && c.sex !== 'm' },
  { kind: 'flag', key: 'trocken', label: 'trocken', aliases: ['trocken', 'galt'], test: (c) => c.dry },
  { kind: 'flag', key: 'mitjungen', label: 'mit saugenden Jungen', aliases: ['mitlaemmern', 'mitjungen', 'saugend'], test: (c) => c.nursing > 0 },
  { kind: 'flag', key: 'maennlich', label: 'männlich', aliases: ['maennlich', 'widder'], test: (c) => c.sex === 'm' },
  { kind: 'flag', key: 'weiblich', label: 'weiblich', aliases: ['weiblich'], test: (c) => c.sex === 'w' },
  { kind: 'flag', key: 'ohnegruppe', label: 'ohne Gruppe', aliases: ['ohnegruppe'], test: (c) => c.groupId == null },
  { kind: 'choice', key: 'gruppe', label: 'Tiergruppe', aliases: ['gruppe', 'herde'], options: (c, ctx) => [ctx.groupName(c) ?? ''] },
  { kind: 'choice', key: 'liste', label: 'Merkliste', aliases: ['liste', 'merkliste'], options: (c, ctx) => ctx.listNames(c) },
]

export const BOARD_EXAMPLES = [
  { q: 'ZZ > 200', text: 'Zellzahl über 200 Tsd. pro ml (Ø 12 Monate)' },
  { q: 'ZZ > 200 und leer', text: 'hohe Zellzahl und nicht trächtig' },
  { q: 'Index Milch < 95', text: 'Milch-Index unter dem Herdenmittel' },
  { q: 'Alter > 6 J', text: 'älter als 6 Jahre (auch 18 Mt oder 90 T)' },
  { q: 'Laktation >= 3 und Leistung < 90', text: 'ab der 3. Laktation, Leistung unter 90 % der Gleichaltrigen' },
  { q: 'Tage seit Ablammung > 60 und leer', text: 'seit über 60 Tagen abgelammt und nicht trächtig' },
  { q: 'Gruppe = galt', text: 'Tiere der Gruppe «galt» (auch nur der Anfang des Namens)' },
  { q: 'Fleischwert > 150', text: 'geschätzter Fleischwert über 150 Franken (Schafe)' },
  { q: '101', text: 'Nummer, Ohrmarke oder Name enthält «101»' },
]

export const boardTexts = (c: BoardCard) => [c.laufNr, c.shortTag, c.earTag, c.name]

export type BoardParsedQuery = ParsedQuery<BoardCard, QueryContext>
export const parseQuery = (input: string): BoardParsedQuery => engineParse(QUERY_FIELDS, input)
export const matchesQuery = (c: BoardCard, q: BoardParsedQuery, ctx: QueryContext) => engineMatches(c, q, ctx, boardTexts)
export { describeCondition, norm }
export const suggest = (input: string, groupNames: string[] = [], listNames: string[] = []) => engineSuggest(QUERY_FIELDS, input, { gruppe: groupNames, liste: listNames }, BOARD_EXAMPLES.slice(0, 7).map((e) => ({ insert: e.q, label: e.text })))

/** Vorgefertigte Filtervorschläge des Dashboards als Formeln (Suchfeld) mit kurzer Beschriftung. */
export function boardPresets(sheep: boolean): QueryPreset[] {
  return [
    { id: 'p-pregnant', name: 'Trächtig', short: 'Trächt.', formula: 'trächtig', color: 'blau' },
    { id: 'p-empty', name: 'Leer (nicht trächtig)', short: 'Leer', formula: 'leer', color: 'orange' },
    { id: 'p-soon', name: 'Geburt in 30 Tagen', short: 'Geb ≤30T', formula: 'Tage bis Geburt <= 30', color: 'violett' },
    { id: 'p-nursing', name: sheep ? 'Mit saugenden Lämmern' : 'Mit saugenden Kälbern', short: sheep ? 'm.Lämm.' : 'm.Käl.', formula: 'mit Lämmern', color: 'gruen' },
    { id: 'p-dry', name: 'Trocken', short: 'Troc.', formula: 'trocken', color: 'grau' },
    { id: 'p-cull', name: 'Mit Ausmerzgründen', short: 'Ausm.', formula: 'Gründe >= 1', color: 'rot' },
    { id: 'p-old', name: sheep ? 'Über 6 Jahre alt' : 'Über 8 Jahre alt', short: sheep ? '>6 J' : '>8 J', formula: sheep ? 'Alter > 6 J' : 'Alter > 8 J', color: 'gelb' },
    { id: 'p-unchecked', name: 'Trächtigkeit nicht untersucht', short: 'n.unt.', formula: 'nicht untersucht', color: 'rosa' },
  ].map((p) => ({ ...p, builtin: true }))
}
