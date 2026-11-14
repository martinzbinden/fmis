// Formeln in Suchfeldern aller Listen («ZZ > 200», «Alter > 6 J», «leer», «Gruppe = galt»): Zerlegen, Auswerten, Beschreiben und
// Vorschläge — unabhängig von der Liste. Jede Liste liefert ihre Felder (QueryField); Zahlenfelder, Merkmale ohne Wert und
// Auswahlfelder. Mehrere Bedingungen trennt «und», «&» oder «;». Was nicht als Bedingung erkannt wird, bleibt Freitext.
// Reine Funktionen, getestet (query.test.ts).

export type Op = '>' | '>=' | '<' | '<=' | '=' | '!='

export interface NumField<R, C> {
  kind: 'num'
  key: string
  label: string
  unit: string
  aliases: string[]
  /** Beispiel für Vorschläge und Hilfe, z.B. «ZZ > 200» */
  example: string
  get: (row: R, ctx: C) => number | null
  /** Einheiten im Eingabewert → Faktor auf die Einheit des Feldes */
  units?: Record<string, number>
  defaultUnit?: string
  /** z.B. Zellzahl: «200000» meint Zellen je ml, «200» Tausend */
  normalize?: (v: number) => number
}
export interface FlagField<R> {
  kind: 'flag'
  key: string
  label: string
  aliases: string[]
  test: (row: R) => boolean
}
export interface ChoiceField<R, C> {
  kind: 'choice'
  key: string
  label: string
  aliases: string[]
  /** Werte des Datensatzes (mehrere möglich, z.B. Merklisten) */
  options: (row: R, ctx: C) => string[]
}
export type QueryField<R, C> = NumField<R, C> | FlagField<R> | ChoiceField<R, C>

/** klein, ohne Umlaute, Leerzeichen und Punkte: so werden Feldnamen verglichen */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[\s.\-_]/g, '')

export interface Condition<R, C> {
  field: QueryField<R, C>
  op: Op
  /** Zahl in der Einheit des Feldes, oder Text bei Auswahlfeldern; null bei Merkmalen ohne Wert */
  value: number | string | null
  text: string
}
export interface QueryError {
  text: string
  reason: string
}
export interface ParsedQuery<R, C> {
  conditions: Condition<R, C>[]
  errors: QueryError[]
  /** Rest als Freitext (Nummer, Ohrmarke, Name) */
  free: string
}

const WORD_OPS: Record<string, Op> = { ueber: '>', unter: '<', ab: '>=', bis: '<=', ist: '=' }
const SYMBOL_RE = /^(.*?)(>=|<=|!=|<>|>|<|=|:)\s*(.+)$/
const WORD_RE = /^(.+?)\s+(über|unter|ab|bis|ist)\s+(.+)$/i
/** wie SYMBOL_RE, aber der Wert darf noch fehlen (für Vorschläge) */
const SUGGEST_SYMBOL_RE = /^(.*?)(>=|<=|!=|<>|>|<|=|:)\s*(.*)$/
const NUM_RE = /^(-?\d+(?:[.,]\d+)?)\s*([a-zäöü%.]*)$/i

function findField<R, C>(fields: QueryField<R, C>[], lhs: string, kinds: QueryField<R, C>['kind'][]): QueryField<R, C> | null {
  const n = norm(lhs)
  if (!n) return null
  return fields.find((f) => kinds.includes(f.kind) && f.aliases.includes(n)) ?? null
}

function parseNumber<R, C>(raw: string, f: NumField<R, C>): { value: number } | null {
  const m = NUM_RE.exec(raw.trim())
  if (!m) return null
  let v = Number(m[1].replace(',', '.'))
  const unit = norm(m[2])
  if (f.units && (unit || f.defaultUnit)) {
    const factor = f.units[unit || f.defaultUnit!]
    if (factor == null) return null
    v *= factor
  } else if (unit && !['k', 'tsd', '%', 'kg', 'fr', 'chf', 't', 'ha', 'a', 'm', 'h'].includes(unit)) return null
  return { value: f.normalize ? f.normalize(v) : v }
}

function parsePart<R, C>(fields: QueryField<R, C>[], part: string): Condition<R, C> | QueryError | 'free' {
  const text = part.trim()
  if (!text) return 'free'
  const sym = SYMBOL_RE.exec(text)
  const word = sym ? null : WORD_RE.exec(text)
  if (sym || word) {
    const lhs = (sym ? sym[1] : word![1]).trim()
    const rawOp = sym ? sym[2] : norm(word![2])
    const rhs = (sym ? sym[3] : word![3]).trim()
    const op: Op = sym ? (rawOp === ':' ? '=' : rawOp === '<>' ? '!=' : (rawOp as Op)) : WORD_OPS[rawOp]
    const f = findField(fields, lhs, ['num', 'choice'])
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
  const flag = findField(fields, text, ['flag'])
  if (flag) return { field: flag, op: '=', value: null, text }
  return 'free'
}

/** Eingabe zerlegen: Bedingungen, nicht erkannte Teile mit Operator (Fehler) und Freitext. */
export function parseQuery<R, C>(fields: QueryField<R, C>[], input: string): ParsedQuery<R, C> {
  const parts = input.split(/\s+und\s+|\s*&&?\s*|\s*;\s*/i)
  const out: ParsedQuery<R, C> = { conditions: [], errors: [], free: '' }
  const free: string[] = []
  for (const p of parts) {
    const r = parsePart(fields, p)
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

export function matchesCondition<R, C>(row: R, cond: Condition<R, C>, ctx: C): boolean {
  const f = cond.field
  if (f.kind === 'flag') return f.test(row)
  if (f.kind === 'num') {
    const v = f.get(row, ctx)
    // Ohne Wert trifft keine Bedingung zu: unbekannt ist nicht «anders»
    return v != null && compare(v, cond.op, cond.value as number)
  }
  const want = norm(String(cond.value))
  const has = f.options(row, ctx).map(norm)
  const hit = has.some((o) => o === want || (want.length >= 2 && o.startsWith(want)))
  return cond.op === '=' ? hit : !hit
}

/** Trifft der Datensatz den Freitext (gegen `texts`) und alle Bedingungen? */
export function matchesQuery<R, C>(row: R, q: ParsedQuery<R, C>, ctx: C, texts: (row: R) => (string | null | undefined)[]): boolean {
  if (q.free && !texts(row).some((x) => x?.toLowerCase().includes(q.free))) return false
  return q.conditions.every((cond) => matchesCondition(row, cond, ctx))
}

const OP_LABEL: Record<Op, string> = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '=': '=', '!=': '≠' }
export function describeCondition<R, C>(cond: Condition<R, C>): string {
  const f = cond.field
  if (f.kind === 'flag') return f.label
  if (f.kind === 'choice') return `${f.label} ${OP_LABEL[cond.op]} ${cond.value}`
  const rhs = cond.text.replace(/^.*?(?:>=|<=|!=|<>|>|<|=|:|\s(?:über|unter|ab|bis|ist)\s)\s*/i, '')
  return `${f.label} ${OP_LABEL[cond.op]} ${rhs}${f.unit && !/[a-zäöü%]/i.test(rhs) ? ` ${f.unit}` : ''}`
}

/** Sortierung, die zu den Bedingungen passt: nach dem ersten Zahlenfeld mit Vergleich — «>»/«≥» grösste zuerst, «<»/«≤» kleinste zuerst. */
export interface SortSuggestion<R, C> {
  field: NumField<R, C>
  desc: boolean
  /** Beschriftung für das Sortierfeld, z.B. «Zellzahl Ø 12 Monate ↓» */
  label: string
}
export function suggestSort<R, C>(q: ParsedQuery<R, C>): SortSuggestion<R, C> | null {
  for (const c of q.conditions) {
    if (c.field.kind !== 'num' || c.op === '=' || c.op === '!=') continue
    const desc = c.op === '>' || c.op === '>='
    return { field: c.field, desc, label: `${c.field.label} ${desc ? '↓' : '↑'}` }
  }
  return null
}

/** Vergleichsfunktion für eine Sortierempfehlung; Datensätze ohne Wert kommen ans Ende. */
export function sortBySuggestion<R, C>(s: SortSuggestion<R, C>, ctx: C): (a: R, b: R) => number {
  return (a, b) => {
    const x = s.field.get(a, ctx)
    const y = s.field.get(b, ctx)
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return s.desc ? y - x : x - y
  }
}

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

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Vorschläge beim Tippen für den letzten Teil der Eingabe. `choices`: Werte der Auswahlfelder je Feldschlüssel. */
export function suggest<R, C>(fields: QueryField<R, C>[], input: string, choices: Record<string, string[]> = {}, examples: Suggestion[] = []): Suggestion[] {
  const { part } = currentPart(input)
  const typed = part.trimStart()
  const n = norm(typed)
  if (!n) return examples
  const sym = SUGGEST_SYMBOL_RE.exec(typed)
  const word = sym ? null : WORD_RE.exec(typed)
  const lhs = sym ? sym[1] : word ? word[1] : null
  if (lhs != null) {
    const f = findField(fields, lhs, ['num', 'choice'])
    const opText = (sym ? sym[2] : word![2]).trim()
    const rhs = (sym ? sym[3] : word![3]).toLowerCase()
    if (f?.kind === 'choice') {
      return (choices[f.key] ?? [])
        .filter((x) => !rhs || x.toLowerCase().includes(rhs))
        .slice(0, 8)
        .map((x) => ({ insert: `${cap(f.aliases[0])} ${opText} ${x}`, label: x }))
    }
    if (f?.kind === 'num' && !rhs) return [{ insert: `${lhs.trim()} ${opText} ${f.example.split(' ').slice(-2).join(' ')}`, label: `z.B. ${f.example}`, hint: f.unit || undefined }]
    return []
  }
  const out: Suggestion[] = []
  for (const f of fields) {
    if (!(f.aliases.some((a) => a.startsWith(n)) || norm(f.label).includes(n))) continue
    if (f.kind === 'flag') out.push({ insert: f.aliases[0], label: f.label, hint: 'ohne Wert' })
    else if (f.kind === 'choice') out.push({ insert: `${cap(f.aliases[0])} = `, label: f.label, hint: `z.B. ${cap(f.aliases[0])} = …` })
    else out.push({ insert: `${f.aliases[0].toUpperCase() === f.aliases[0] ? f.aliases[0] : cap(f.aliases[0])} > `, label: f.label, hint: f.unit ? `in ${f.unit}` : undefined })
  }
  const exact = findField(fields, typed.trim(), ['num'])
  if (exact) return OPS_HINT.map((o) => ({ insert: `${typed.trim()} ${o.op} `, label: o.label }))
  return out.slice(0, 8)
}
