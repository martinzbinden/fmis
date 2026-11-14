// Texteingabe im Dashboard (pages/Board.tsx, components/QueryInput.tsx): neben Nummer oder Name auch Bedingungen wie
// «ZZ > 200» (Zellzahl über 200 Tsd.), «Alter > 6 J», «leer», «Gruppe = galt». Mehrere Bedingungen trennt «und», «&» oder «;».
// Was nicht als Bedingung erkannt wird, bleibt Freitext (Nummer, Ohrmarke, Name). Reine Funktionen, getestet.

import { weanedOfLastLitter, type BoardCard } from './board'

export type Op = '>' | '>=' | '<' | '<=' | '=' | '!='

export interface QueryContext {
  groupName: (card: BoardCard) => string | null
  listNames: (card: BoardCard) => string[]
  /** geschätzter Fleischwert nach Abzügen (null = unbekannt) */
  meat?: (card: BoardCard) => number | null
}

interface NumField {
  kind: 'num'
  key: string
  label: string
  unit: string
  aliases: string[]
  /** Beispielwert für Vorschläge */
  example: string
  get: (c: BoardCard, ctx: QueryContext) => number | null
  /** Einheiten im Eingabewert → Faktor auf die Einheit des Feldes (Standard 1) */
  units?: Record<string, number>
  /** Anzeige des Eingabewerts, wenn eine Einheit gewählt wurde */
  defaultUnit?: string
}
interface FlagField {
  kind: 'flag'
  key: string
  label: string
  aliases: string[]
  test: (c: BoardCard) => boolean
}
interface ChoiceField {
  kind: 'choice'
  key: string
  label: string
  aliases: string[]
  options: (c: BoardCard, ctx: QueryContext) => string[]
}
export type QueryField = NumField | FlagField | ChoiceField

const none = <T,>(v: T | null | undefined) => (v == null ? null : v)

export const QUERY_FIELDS: QueryField[] = [
  { kind: 'num', key: 'zz', label: 'Zellzahl Ø 12 Monate', unit: 'Tsd./ml', aliases: ['zz', 'zellzahl', 'zellen', 'scc'], example: 'ZZ > 200', get: (c) => none(c.scc12m) },
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

/** klein, ohne Umlaute, Leerzeichen und Punkte: so werden Feldnamen verglichen */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[\s.\-_]/g, '')

export interface Condition {
  field: QueryField
  op: Op
  /** Zahl in der Einheit des Feldes, oder Text bei Auswahlfeldern; null bei Merkmalen ohne Wert */
  value: number | string | null
  /** Anzeige wie eingegeben */
  text: string
}
export interface QueryError {
  text: string
  reason: string
}
export interface ParsedQuery {
  conditions: Condition[]
  errors: QueryError[]
  /** Rest als Freitext (Nummer, Ohrmarke, Name) */
  free: string
}

const WORD_OPS: Record<string, Op> = { ueber: '>', unter: '<', ab: '>=', bis: '<=', ist: '=' }
const SYMBOL_RE = /^(.*?)(>=|<=|!=|<>|>|<|=|:)\s*(.+)$/
const WORD_RE = /^(.+?)\s+(über|unter|ab|bis|ist)\s+(.+)$/i

function findField(lhs: string, kinds: QueryField['kind'][]): QueryField | null {
  const n = norm(lhs)
  if (!n) return null
  return QUERY_FIELDS.find((f) => kinds.includes(f.kind) && f.aliases.includes(n)) ?? null
}

const NUM_RE = /^(-?\d+(?:[.,]\d+)?)\s*([a-zäöü%.]*)$/i

function parseNumber(raw: string, f: NumField): { value: number; shown: string } | null {
  const m = NUM_RE.exec(raw.trim())
  if (!m) return null
  let v = Number(m[1].replace(',', '.'))
  const unit = norm(m[2])
  if (f.units && (unit || f.defaultUnit)) {
    const factor = f.units[unit || f.defaultUnit!]
    if (factor == null) return null
    v *= factor
  } else if (unit && !['k', 'tsd', '%', 'kg', 'fr', 'chf', 't'].includes(unit)) return null
  // Zellzahl: «200000» meint Zellen je ml, «200» Tausend
  if (f.key === 'zz' && v >= 5000) v /= 1000
  return { value: v, shown: `${m[1]}${m[2] ? ` ${m[2]}` : ''}` }
}

function parsePart(part: string): Condition | QueryError | 'free' {
  const text = part.trim()
  if (!text) return 'free'
  const sym = SYMBOL_RE.exec(text)
  const word = sym ? null : WORD_RE.exec(text)
  if (sym || word) {
    const lhs = (sym ? sym[1] : word![1]).trim()
    const rawOp = sym ? sym[2] : norm(word![2])
    const rhs = (sym ? sym[3] : word![3]).trim()
    const op: Op = sym ? (rawOp === ':' ? '=' : rawOp === '<>' ? '!=' : (rawOp as Op)) : WORD_OPS[rawOp]
    const f = findField(lhs, ['num', 'choice'])
    if (!f) return { text, reason: `«${lhs}» ist kein bekanntes Feld` }
    if (f.kind === 'choice') {
      if (op !== '=' && op !== '!=') return { text, reason: `«${f.label}» kennt nur = und !=` }
      return { field: f, op, value: rhs, text }
    }
    if (f.kind === 'num') {
      const v = parseNumber(rhs, f)
      if (!v) return { text, reason: `«${rhs}» ist keine Zahl${f.units ? ' (z.B. 6 J, 18 Mt, 90 T)' : ''}` }
      return { field: f, op, value: v.value, text }
    }
  }
  const flag = findField(text, ['flag'])
  if (flag) return { field: flag, op: '=', value: null, text }
  return 'free'
}

/** Eingabe zerlegen: Bedingungen, nicht erkannte Teile mit Operator (Fehler) und Freitext. */
export function parseQuery(input: string): ParsedQuery {
  const parts = input.split(/\s+und\s+|\s*&&?\s*|\s*;\s*/i)
  const out: ParsedQuery = { conditions: [], errors: [], free: '' }
  const free: string[] = []
  for (const p of parts) {
    const r = parsePart(p)
    if (r === 'free') {
      if (p.trim()) free.push(p.trim())
    } else if ('reason' in r) out.errors.push(r)
    else out.conditions.push(r)
  }
  out.free = free.join(' ').toLowerCase()
  return out
}

function compare(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '>':
      return a > b
    case '>=':
      return a >= b
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '=':
      return Math.abs(a - b) < 1e-9
    case '!=':
      return Math.abs(a - b) >= 1e-9
  }
}

export function matchesCondition(c: BoardCard, cond: Condition, ctx: QueryContext): boolean {
  const f = cond.field
  if (f.kind === 'flag') return f.test(c)
  if (f.kind === 'num') {
    const v = f.get(c, ctx)
    // Ohne Wert trifft keine Bedingung zu (ausser «!=» mit einem Wert, das tun wir bewusst nicht: unbekannt ist nicht anders)
    return v != null && compare(v, cond.op, cond.value as number)
  }
  const want = norm(String(cond.value))
  const has = f.options(c, ctx).map(norm)
  const hit = has.some((o) => o === want || (want.length >= 2 && o.startsWith(want)))
  return cond.op === '=' ? hit : !hit
}

/** Trifft die Karte Freitext und alle Bedingungen? */
export function matchesQuery(c: BoardCard, q: ParsedQuery, ctx: QueryContext): boolean {
  if (q.free && ![c.laufNr, c.shortTag, c.earTag, c.name].some((x) => x?.toLowerCase().includes(q.free))) return false
  return q.conditions.every((cond) => matchesCondition(c, cond, ctx))
}

const OP_LABEL: Record<Op, string> = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '=': '=', '!=': '≠' }
export function describeCondition(cond: Condition): string {
  const f = cond.field
  if (f.kind === 'flag') return f.label
  if (f.kind === 'choice') return `${f.label} ${OP_LABEL[cond.op]} ${cond.value}`
  const rhs = cond.text.replace(/^.*?(?:>=|<=|!=|<>|>|<|=|:|\s(?:über|unter|ab|bis|ist)\s)\s*/i, '')
  return `${f.label} ${OP_LABEL[cond.op]} ${rhs}${f.unit && !/[a-zäöü%]/i.test(rhs) ? ` ${f.unit}` : ''}`
}

/** Vorschläge beim Tippen für den letzten Teil der Eingabe (Teil nach «und», «&», «;»). */
export interface Suggestion {
  /** ersetzt den letzten Teil */
  insert: string
  label: string
  hint?: string
}

export function currentPart(input: string): { head: string; part: string } {
  const m = /^(.*?(?:\s+und\s+|\s*&&?\s*|\s*;\s*))([^]*)$/i.exec(input)
  return m ? { head: m[1], part: m[2] } : { head: '', part: input }
}

const OPS_HINT: { op: string; label: string }[] = [
  { op: '>', label: 'grösser als' },
  { op: '>=', label: 'mindestens' },
  { op: '<', label: 'kleiner als' },
  { op: '<=', label: 'höchstens' },
  { op: '=', label: 'gleich' },
]

export function suggest(input: string, groupNames: string[] = [], listNames: string[] = []): Suggestion[] {
  const { part } = currentPart(input)
  const typed = part.trimStart()
  const n = norm(typed)
  if (!n) {
    return [
      { insert: 'ZZ > 200', label: 'Zellzahl über 200 Tsd.', hint: 'ZZ > 200' },
      { insert: 'Index Milch < 95', label: 'Milch-Index unter 95', hint: 'Index Milch < 95' },
      { insert: 'Alter > 6 J', label: 'älter als 6 Jahre', hint: 'Alter > 6 J' },
      { insert: 'leer', label: 'nicht trächtige Tiere', hint: 'leer' },
      { insert: 'Laktation >= 3', label: 'ab der 3. Laktation', hint: 'Laktation >= 3' },
      { insert: 'Gruppe = ', label: 'in einer Tiergruppe', hint: 'Gruppe = galt' },
      { insert: 'ZZ > 200 und leer', label: 'mehrere Bedingungen', hint: 'mit «und» verbinden' },
    ]
  }
  // Operator schon getippt: Werte vorschlagen
  const sym = SYMBOL_RE.exec(typed)
  const word = sym ? null : WORD_RE.exec(typed)
  const lhs = sym ? sym[1] : word ? word[1] : null
  if (lhs != null) {
    const f = findField(lhs, ['num', 'choice'])
    const opText = sym ? sym[2] : word![2]
    const rhs = (sym ? sym[3] : word![3]).toLowerCase()
    if (f?.kind === 'choice') {
      const names = f.key === 'gruppe' ? groupNames : listNames
      return names.filter((x) => !rhs || x.toLowerCase().includes(rhs)).slice(0, 8).map((x) => ({ insert: `${f.label.split(' ')[0] === 'Tiergruppe' ? 'Gruppe' : 'Liste'} ${opText.trim()} ${x}`, label: x }))
    }
    if (f?.kind === 'num' && !rhs) return [{ insert: `${lhs.trim()} ${opText.trim()} ${f.example.split(' ').slice(-2).join(' ')}`, label: `z.B. ${f.example}`, hint: f.unit }]
    return []
  }
  const out: Suggestion[] = []
  for (const f of QUERY_FIELDS) {
    const hit = f.aliases.some((a) => a.startsWith(n)) || norm(f.label).includes(n)
    if (!hit) continue
    if (f.kind === 'flag') out.push({ insert: f.aliases[0] === 'leer' ? 'leer' : f.label, label: f.label, hint: 'ohne Wert' })
    else if (f.kind === 'choice') out.push({ insert: `${f.aliases[0][0].toUpperCase()}${f.aliases[0].slice(1)} = `, label: f.label, hint: 'z.B. Gruppe = galt' })
    else out.push({ insert: `${f.aliases[0].toUpperCase() === f.aliases[0] ? f.aliases[0] : f.aliases[0][0].toUpperCase() + f.aliases[0].slice(1)} > `, label: f.label, hint: f.unit ? `in ${f.unit}` : undefined })
  }
  // genau ein Feld erkannt, noch kein Operator: Operatoren anbieten
  const exact = findField(typed.trim(), ['num'])
  if (exact) return OPS_HINT.map((o) => ({ insert: `${typed.trim()} ${o.op} `, label: o.label }))
  return out.slice(0, 8)
}
