// Allgemeine Filter für Listen und Karten (Dashboard, später auch andere Listen).
//
// Eine Seite beschreibt ihre Zeilen mit FieldDef (Feld, Typ, Zugriff); Filter sind
// vom Benutzer gebaute Bedingungen auf diesen Feldern: «Alter über 6 Jahre UND
// trächtig». Nichts hier kennt Tiere — es rechnet nur Bedingungen auf Zeilen aus.

export type FieldType = 'text' | 'number' | 'date' | 'choice' | 'bool'

export type FieldValue = string | number | boolean | null | undefined | readonly string[]

export interface FieldDef<R> {
  key: string
  label: string
  type: FieldType
  /** Überschrift in der Feldauswahl */
  group?: string
  /** Einheit hinter Zahlen, z.B. «Monate» */
  unit?: string
  /** Auswahlwerte (choice) */
  options?: { value: string; label: string }[]
  /** Wert der Zeile: Text, Zahl, ISO-Datum (YYYY-MM-DD), Ja/Nein oder mehrere Werte (choice) */
  get(row: R): FieldValue
}

export type Op =
  // Text
  | 'contains'
  | 'not_contains'
  | 'equals'
  // Zahl
  | 'eq'
  | 'ne'
  | 'lt'
  | 'le'
  | 'gt'
  | 'ge'
  | 'between'
  // Datum
  | 'on'
  | 'before'
  | 'after'
  | 'older_days'
  | 'within_days'
  | 'next_days'
  // Auswahl
  | 'is'
  | 'is_not'
  // Ja/Nein
  | 'yes'
  | 'no'
  // alle
  | 'empty'
  | 'not_empty'

export interface Condition {
  field: string
  op: Op
  /** Text, Zahl oder Datum als Text; Tage als Zahl */
  value?: string
  /** zweiter Wert bei «zwischen» */
  value2?: string
  /** gewählte Werte bei Auswahl */
  values?: string[]
}

export interface FilterDef {
  id: string
  name: string
  /** Schlüssel aus FILTER_COLORS */
  color: string
  match: 'all' | 'any'
  conditions: Condition[]
  /** mitgelieferte Vorlage (nicht änderbar, aber kopierbar) */
  preset?: boolean
}

/** Wie ein Filter wirkt: aus, Treffer einfärben oder nur Treffer zeigen. */
export type FilterMode = 'off' | 'color' | 'only'

export const OPS_BY_TYPE: Record<FieldType, Op[]> = {
  text: ['contains', 'not_contains', 'equals', 'empty', 'not_empty'],
  number: ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'between', 'empty', 'not_empty'],
  date: ['on', 'before', 'after', 'between', 'older_days', 'within_days', 'next_days', 'empty', 'not_empty'],
  choice: ['is', 'is_not', 'empty', 'not_empty'],
  bool: ['yes', 'no'],
}

export const OP_LABEL: Record<Op, string> = {
  contains: 'enthält',
  not_contains: 'enthält nicht',
  equals: 'ist genau',
  eq: '=',
  ne: '≠',
  lt: '<',
  le: '≤',
  gt: '>',
  ge: '≥',
  between: 'zwischen',
  on: 'am',
  before: 'vor',
  after: 'nach',
  older_days: 'vor mehr als … Tagen',
  within_days: 'in den letzten … Tagen',
  next_days: 'in den nächsten … Tagen',
  is: 'ist',
  is_not: 'ist nicht',
  yes: 'ja',
  no: 'nein',
  empty: 'leer / unbekannt',
  not_empty: 'vorhanden',
}

/** Wie viele Eingaben eine Operation braucht. */
export function opInputs(op: Op): 'none' | 'one' | 'two' | 'choice' {
  if (op === 'empty' || op === 'not_empty' || op === 'yes' || op === 'no') return 'none'
  if (op === 'between') return 'two'
  if (op === 'is' || op === 'is_not') return 'choice'
  return 'one'
}

export const FILTER_COLORS = [
  { key: 'rot', label: 'Rot', dot: 'bg-red-500', card: 'border-red-400 bg-red-50', chip: 'border-red-400 bg-red-100 text-red-900' },
  { key: 'orange', label: 'Orange', dot: 'bg-orange-500', card: 'border-orange-400 bg-orange-50', chip: 'border-orange-400 bg-orange-100 text-orange-900' },
  { key: 'gelb', label: 'Gelb', dot: 'bg-yellow-400', card: 'border-yellow-400 bg-yellow-50', chip: 'border-yellow-400 bg-yellow-100 text-yellow-900' },
  { key: 'gruen', label: 'Grün', dot: 'bg-green-500', card: 'border-green-400 bg-green-50', chip: 'border-green-400 bg-green-100 text-green-900' },
  { key: 'tuerkis', label: 'Türkis', dot: 'bg-teal-500', card: 'border-teal-400 bg-teal-50', chip: 'border-teal-400 bg-teal-100 text-teal-900' },
  { key: 'blau', label: 'Blau', dot: 'bg-sky-500', card: 'border-sky-400 bg-sky-50', chip: 'border-sky-400 bg-sky-100 text-sky-900' },
  { key: 'violett', label: 'Violett', dot: 'bg-violet-500', card: 'border-violet-400 bg-violet-50', chip: 'border-violet-400 bg-violet-100 text-violet-900' },
  { key: 'rosa', label: 'Rosa', dot: 'bg-pink-500', card: 'border-pink-400 bg-pink-50', chip: 'border-pink-400 bg-pink-100 text-pink-900' },
  { key: 'grau', label: 'Grau', dot: 'bg-gray-500', card: 'border-gray-400 bg-gray-100', chip: 'border-gray-400 bg-gray-200 text-gray-900' },
] as const

export type FilterColorKey = (typeof FILTER_COLORS)[number]['key']

export const colorOf = (key: string) => FILTER_COLORS.find((c) => c.key === key) ?? FILTER_COLORS[FILTER_COLORS.length - 1]

export interface EvalContext {
  /** heute als ISO-Datum, Bezug für «vor mehr als … Tagen» */
  today: string
}

const isEmpty = (v: FieldValue): boolean => v == null || v === '' || (Array.isArray(v) && v.length === 0)

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000)

/** Zahl aus Eingabe; Komma als Dezimaltrenner erlaubt. null = nicht lesbar. */
export function parseNumber(text: string | undefined): number | null {
  if (text == null || text.trim() === '') return null
  const n = Number(text.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const norm = (s: string) => s.trim().toLowerCase()

/** Trifft die Bedingung auf diesen Wert zu? Unvollständige Bedingungen (kein Wert eingegeben) treffen nie zu. */
export function matchesCondition(value: FieldValue, type: FieldType, c: Condition, ctx: EvalContext): boolean {
  if (c.op === 'empty') return isEmpty(value)
  if (c.op === 'not_empty') return !isEmpty(value)

  if (type === 'bool') {
    if (c.op === 'yes') return value === true
    if (c.op === 'no') return value !== true
    return false
  }

  if (type === 'choice') {
    const have = Array.isArray(value) ? (value as readonly string[]) : value == null || value === '' ? [] : [String(value)]
    const want = c.values ?? []
    if (want.length === 0) return false
    const hit = want.some((w) => have.includes(w))
    return c.op === 'is' ? hit : c.op === 'is_not' ? !hit : false
  }

  if (isEmpty(value)) return c.op === 'ne' || c.op === 'not_contains' || c.op === 'is_not'

  if (type === 'text') {
    const text = norm(String(value))
    const q = norm(c.value ?? '')
    if (!q) return false
    if (c.op === 'contains') return text.includes(q)
    if (c.op === 'not_contains') return !text.includes(q)
    if (c.op === 'equals') return text === q
    return false
  }

  if (type === 'number') {
    const v = typeof value === 'number' ? value : parseNumber(String(value))
    const a = parseNumber(c.value)
    if (v == null || a == null) return false
    const b = parseNumber(c.value2)
    switch (c.op) {
      case 'eq':
        return v === a
      case 'ne':
        return v !== a
      case 'lt':
        return v < a
      case 'le':
        return v <= a
      case 'gt':
        return v > a
      case 'ge':
        return v >= a
      case 'between':
        return b != null && v >= Math.min(a, b) && v <= Math.max(a, b)
      default:
        return false
    }
  }

  // Datum
  const iso = String(value).slice(0, 10)
  const d = dayNumber(iso)
  const today = dayNumber(ctx.today)
  const asDay = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? dayNumber(s) : null)
  const a = asDay(c.value)
  const days = parseNumber(c.value)
  switch (c.op) {
    case 'on':
      return a != null && d === a
    case 'before':
      return a != null && d < a
    case 'after':
      return a != null && d > a
    case 'between': {
      const b = asDay(c.value2)
      return a != null && b != null && d >= Math.min(a, b) && d <= Math.max(a, b)
    }
    case 'older_days':
      return days != null && d < today - days
    case 'within_days':
      return days != null && d <= today && d >= today - days
    case 'next_days':
      return days != null && d >= today && d <= today + days
    default:
      return false
  }
}

/** Trifft die Zeile den Filter? Ein Filter ohne Bedingungen trifft nie zu (sonst färbte er alles). */
export function matchesFilter<R>(row: R, filter: FilterDef, fields: FieldDef<R>[], ctx: EvalContext): boolean {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const results = filter.conditions.map((c) => {
    const f = byKey.get(c.field)
    return f ? matchesCondition(f.get(row), f.type, c, ctx) : false
  })
  if (results.length === 0) return false
  return filter.match === 'all' ? results.every(Boolean) : results.some(Boolean)
}

export interface FilterResult {
  /** nicht von einem «nur zeigen»-Filter ausgeblendet */
  visible: boolean
  /** Farben der passenden Filter im Modus «einfärben», in Reihenfolge der Filterliste */
  colors: string[]
  /** Namen dieser Filter (für Tooltips) */
  names: string[]
}

/** Wirkung aller Filter auf eine Zeile: «nur zeigen» müssen alle zutreffen, «einfärben» sammelt Farben. */
export function applyFilters<R>(row: R, filters: FilterDef[], modes: Record<string, FilterMode>, fields: FieldDef<R>[], ctx: EvalContext): FilterResult {
  let visible = true
  const colors: string[] = []
  const names: string[] = []
  for (const f of filters) {
    const mode = modes[f.id] ?? 'off'
    if (mode === 'off') continue
    const hit = matchesFilter(row, f, fields, ctx)
    if (mode === 'only' && !hit) visible = false
    if (mode === 'color' && hit) {
      if (!colors.includes(f.color)) colors.push(f.color)
      names.push(f.name)
    }
  }
  return { visible, colors, names }
}

/** Anzahl Treffer je Filter (für die Zahl auf dem Knopf). */
export function countMatches<R>(rows: R[], filter: FilterDef, fields: FieldDef<R>[], ctx: EvalContext): number {
  return rows.reduce((n, r) => n + (matchesFilter(r, filter, fields, ctx) ? 1 : 0), 0)
}

const fmtIso = (iso: string | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : (iso ?? ''))

/** Bedingung als Satz, z.B. «Alter > 72 Monate». */
export function describeCondition<R>(c: Condition, fields: FieldDef<R>[]): string {
  const f = fields.find((x) => x.key === c.field)
  const label = f?.label ?? c.field
  const unit = f?.unit ? ` ${f.unit}` : ''
  const labelOf = (v: string) => f?.options?.find((o) => o.value === v)?.label ?? v
  const isDate = f?.type === 'date'
  const val = (v: string | undefined) => (isDate ? fmtIso(v) : (v ?? ''))
  switch (opInputs(c.op)) {
    case 'none':
      return `${label} ${OP_LABEL[c.op]}`
    case 'choice':
      return `${label} ${OP_LABEL[c.op]} ${(c.values ?? []).map(labelOf).join(' / ')}`
    case 'two':
      return `${label} zwischen ${val(c.value)} und ${val(c.value2)}${unit}`
    default:
      if (c.op === 'older_days' || c.op === 'within_days' || c.op === 'next_days') return `${label} ${OP_LABEL[c.op].replace('…', c.value ?? '…')}`
      return `${label} ${OP_LABEL[c.op]} ${val(c.value)}${unit}`
  }
}

export function describeFilter<R>(f: FilterDef, fields: FieldDef<R>[]): string {
  return f.conditions.map((c) => describeCondition(c, fields)).join(f.match === 'all' ? ' und ' : ' oder ')
}

/** Standard-Bedingung für ein Feld (erste passende Operation). */
export function blankCondition<R>(field: FieldDef<R>): Condition {
  return { field: field.key, op: OPS_BY_TYPE[field.type][0] }
}

/** Passt die Bedingung zu einem anderen Feld an (Operation wechselt mit dem Typ). */
export function retargetCondition<R>(c: Condition, field: FieldDef<R>): Condition {
  const ops = OPS_BY_TYPE[field.type]
  return { field: field.key, op: ops.includes(c.op) ? c.op : ops[0], value: undefined, value2: undefined, values: undefined }
}

/** Fehlt noch eine Eingabe? (Speichern erst, wenn alle Bedingungen vollständig sind.) */
export function conditionComplete(c: Condition): boolean {
  switch (opInputs(c.op)) {
    case 'none':
      return true
    case 'choice':
      return (c.values ?? []).length > 0
    case 'two':
      return !!c.value?.trim() && !!c.value2?.trim()
    default:
      return !!c.value?.trim()
  }
}
