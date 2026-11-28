// «Strukturierte Daten einfügen» für Futter (Futterkäufe und -verbrauch einer Mastgruppe): eine Zeile je Posten.
// Die Gruppe wird über ihren Namen gefunden. Doppelt = gleiche Gruppe, gleicher Tag, gleiche Futterart, gleiche
// Menge und Einheit (schon erfasst oder zweimal im Block). Nur ergänzen, nie überschreiben.

import type { PGlite } from '@electric-sql/pglite'
import { readDate, readNumber, readText, unknownFields, type CheckedRow, type PasteField, type PasteImporter } from '@fmis/core/pasteImport'
import { upsertRows } from '../db/write'

/** Einheiten wie in «Futter erfassen». */
export const FEED_UNITS = ['kg', 'dt', 'Ballen', 'Stück', 'Liter'] as const

export const FEED_FIELDS: PasteField[] = [
  { name: 'gruppe', required: true, type: 'Text', description: 'Name der Mastgruppe wie im Mastplaner' },
  { name: 'datum', required: true, type: 'Datum JJJJ-MM-TT', description: 'Kauf- oder Lieferdatum' },
  { name: 'futterart', required: true, type: 'Text', description: 'Bezeichnung, z.B. Lämmermastfutter, Siloballen, Salzleckstein' },
  { name: 'menge', required: true, type: 'Zahl', description: 'Menge in der Einheit' },
  { name: 'einheit', type: 'Text', description: `${FEED_UNITS.join(', ')} (ohne Angabe kg)` },
  { name: 'kosten', type: 'Zahl', description: 'Kosten total in Fr. für diesen Posten' },
  { name: 'lieferant', type: 'Text', description: '' },
  { name: 'notiz', type: 'Text', description: '' },
]

export interface FeedValue {
  group_id: string
  date: string
  feed_type: string
  quantity: number
  unit: string
  cost_total: number | null
  supplier: string | null
  notes: string | null
}

export interface FeedGroup {
  id: string
  name: string
}

export interface ExistingFeed {
  group_id: string
  date: string
  feed_type: string
  quantity: number
  unit: string
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const dupKey = (v: ExistingFeed) => `${v.group_id}|${v.date}|${norm(v.feed_type)}|${Number(v.quantity)}|${norm(v.unit)}`

/** Einheit tolerant lesen: «Stk», «Stück», «KG» … */
export function readUnit(v: unknown): string | null {
  const t = readText(v)
  if (!t) return 'kg'
  const n = norm(t).replace(/\.$/, '')
  if (n === 'stk' || n === 'stück' || n === 'stueck' || n === 'st') return 'Stück'
  if (n === 'l' || n === 'liter') return 'Liter'
  if (n === 'balle' || n === 'ballen') return 'Ballen'
  return FEED_UNITS.find((u) => u.toLowerCase() === n) ?? null
}

export function checkFeed(rows: Record<string, unknown>[], groups: FeedGroup[], existing: ExistingFeed[]): CheckedRow[] {
  const known = new Set(existing.map(dupKey))
  const inBlock = new Set<string>()
  return rows.map((row, index) => {
    const problems: string[] = []
    const warnings: string[] = []
    const groupName = readText(row.gruppe)
    const hits = groupName ? groups.filter((g) => norm(g.name) === norm(groupName)) : []
    if (!groupName) problems.push('gruppe fehlt')
    else if (hits.length === 0) problems.push(`gruppe «${groupName}» nicht gefunden${groups.length ? ` (vorhanden: ${groups.map((g) => g.name).join(', ')})` : ''}`)
    else if (hits.length > 1) problems.push(`gruppe «${groupName}» gibt es mehrfach`)
    const date = readDate(row.datum)
    if (date.error) problems.push(date.error)
    else if (!date.value) problems.push('datum fehlt')
    const feedType = readText(row.futterart)
    if (!feedType) problems.push('futterart fehlt')
    const qty = readNumber(row.menge)
    if (qty.error) problems.push(`menge: ${qty.error}`)
    else if (qty.value == null) problems.push('menge fehlt')
    else if (qty.value <= 0) problems.push('menge muss grösser als 0 sein')
    const unit = readUnit(row.einheit)
    if (!unit) problems.push(`einheit «${String(row.einheit)}» unbekannt (${FEED_UNITS.join(', ')})`)
    const cost = readNumber(row.kosten)
    if (cost.error) problems.push(`kosten: ${cost.error}`)
    else if (cost.value != null && cost.value < 0) problems.push('kosten dürfen nicht negativ sein')
    else if (cost.value == null) warnings.push('ohne Kosten: zählt nicht in den Futterkosten der Gruppe')
    const unknown = unknownFields(row, FEED_FIELDS)
    if (unknown.length) warnings.push(`unbekannte Felder ignoriert: ${unknown.join(', ')}`)

    const value: FeedValue = {
      group_id: hits.length === 1 ? hits[0].id : '',
      date: date.value ?? '',
      feed_type: feedType ?? '',
      quantity: qty.value ?? 0,
      unit: unit ?? '',
      cost_total: cost.value,
      supplier: readText(row.lieferant),
      notes: readText(row.notiz),
    }
    let status: CheckedRow['status'] = problems.length ? 'fehler' : 'neu'
    const dup = status === 'neu' ? dupKey(value) : null
    if (dup && known.has(dup)) {
      status = 'doppelt'
      problems.push('schon erfasst (gleiche Gruppe, gleicher Tag, gleiche Futterart und Menge)')
    } else if (dup && inBlock.has(dup)) {
      status = 'doppelt'
      problems.push('zweimal im eingefügten Block')
    }
    if (dup) inBlock.add(dup)
    return {
      index,
      status,
      title: `${date.value ?? '?'} · ${groupName ?? '?'} · ${feedType ?? '?'}`,
      detail: [qty.value != null && unit ? `${qty.value} ${unit}` : null, cost.value != null ? `${cost.value.toFixed(2)} Fr.` : null, value.supplier].filter(Boolean).join(' · '),
      problems,
      warnings,
      value,
    }
  })
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10))

async function loadGroups(db: PGlite): Promise<FeedGroup[]> {
  const { rows } = await db.query<FeedGroup>('select id, name from animal_groups where deleted_at is null order by created_date desc')
  return rows
}

async function loadExisting(db: PGlite): Promise<ExistingFeed[]> {
  const { rows } = await db.query<Record<string, unknown>>('select group_id, date, feed_type, quantity, unit from feed_records where deleted_at is null')
  return rows.map((r) => ({ group_id: String(r.group_id), date: iso(r.date), feed_type: String(r.feed_type), quantity: Number(r.quantity), unit: String(r.unit) }))
}

export const feedPasteImporter: PasteImporter = {
  area: 'futter',
  label: 'Futter (Mastgruppen)',
  description:
    'Eine Zeile je Futterposten einer Mastgruppe (Kraftfutter, Siloballen, Lecksteine …) mit Menge und Kosten. ' +
    'Die Kosten verteilt der Mastplaner nach Masttagen auf die Tiere der Gruppe. Gleicher Posten am gleichen Tag gilt als doppelt.',
  permission: 'livestock:feed:write',
  fields: FEED_FIELDS,
  example: [
    { gruppe: 'Mastlämmer Herbst', datum: '2026-08-20', futterart: 'Lämmermastfutter', menge: 500, einheit: 'kg', kosten: 420, lieferant: 'Futtermühle' },
    { gruppe: 'Mastlämmer Herbst', datum: '2026-08-20', futterart: 'Siloballen', menge: 4, einheit: 'Ballen', kosten: 260 },
  ],
  check: async (db, rows) => checkFeed(rows, await loadGroups(db), await loadExisting(db)),
  apply: async (db, rows) => {
    // gegen den aktuellen Stand: inzwischen Erfasstes nicht doppelt
    const existing = new Set((await loadExisting(db)).map(dupKey))
    const out: Record<string, unknown>[] = []
    for (const r of rows) {
      const v = r.value as FeedValue
      const k = dupKey(v)
      if (!v.group_id || existing.has(k)) continue
      existing.add(k)
      out.push({ id: crypto.randomUUID(), ...v })
    }
    if (out.length) await upsertRows('feed_records', out as never)
    return out.length
  },
}
