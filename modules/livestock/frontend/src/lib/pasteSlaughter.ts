// «Strukturierte Daten einfügen» für Schlachtungen (Schlachtabrechnungen): eine Zeile je Tier. Doppelt = gleiche
// Ohrmarke am gleichen Schlachttag (schon erfasst oder zweimal im Block). Nur ergänzen, nie überschreiben.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { readDate, readNumber, readText, unknownFields, type CheckedRow, type PasteField, type PasteImporter } from '@fmis/core/pasteImport'
import { upsertRows } from '../db/write'
import { CATEGORIES } from './slaughterRecords'

export const SLAUGHTER_FIELDS: PasteField[] = [
  { name: 'datum', required: true, type: 'Datum JJJJ-MM-TT', description: 'Schlachtdatum' },
  { name: 'kategorie', required: true, type: 'Text', description: `${CATEGORIES.join(', ')} (Schaf = SM, Lamm = LA auf der Abrechnung)` },
  { name: 'ohrmarke', type: 'Text', description: 'Kennzeichen wie auf der Abrechnung, z.B. 9999.0001 oder 99990001' },
  { name: 'schlachtgewicht_kg', type: 'Zahl', description: 'Schlachtgewicht (SG) in kg' },
  { name: 'taxation', type: 'Text', description: 'CHTAX, z.B. T2, H3, A1' },
  { name: 'preis_kg', type: 'Zahl', description: 'Preis Fr./kg SG' },
  { name: 'betrag', type: 'Zahl', description: 'Betrag des Tiers in Fr. (ohne Abzüge)' },
  { name: 'bemerkung', type: 'Text', description: 'Vermerk der Abrechnung, z.B. «klein», «nass»' },
  { name: 'abnehmer', type: 'Text', description: 'Schlachtbetrieb oder Händler' },
  { name: 'abrechnung', type: 'Text', description: 'Nummer der Abrechnung' },
  { name: 'waagschein', type: 'Text', description: 'Nummer des Waagscheins' },
  { name: 'notiz', type: 'Text', description: '' },
]

export interface SlaughterValue {
  slaughter_date: string
  ear_tag: string | null
  animal_key: string | null
  category: string
  carcass_kg: number | null
  classification: string | null
  price_per_kg: number | null
  amount: number | null
  remark: string | null
  buyer: string | null
  settlement_no: string | null
  weigh_slip_no: string | null
  notes: string | null
}

const LIMITS: Record<string, [number, number]> = { Lamm: [6, 35], Schaf: [10, 50], Ziege: [5, 50], Kalb: [40, 250], Rind: [150, 500], Kuh: [150, 500] }

/** Kategorie tolerant lesen: «LA» → Lamm, «SM»/«Schaf (SM)» → Schaf. */
export function readCategory(v: unknown): string | null {
  const t = readText(v)?.toLowerCase()
  if (!t) return null
  if (/^la\b|lamm/.test(t)) return 'Lamm'
  if (/^sm\b|schaf|aue|widder/.test(t)) return 'Schaf'
  const hit = CATEGORIES.find((c) => t.startsWith(c.toLowerCase()))
  return hit ?? null
}

export function checkSlaughter(rows: Record<string, unknown>[], existing: { slaughter_date: string; animal_key: string | null }[]): CheckedRow[] {
  const known = new Set(existing.filter((e) => e.animal_key).map((e) => `${e.slaughter_date}|${e.animal_key}`))
  const inBlock = new Set<string>()
  return rows.map((row, index) => {
    const problems: string[] = []
    const warnings: string[] = []
    const date = readDate(row.datum)
    if (date.error) problems.push(date.error)
    else if (!date.value) problems.push('datum fehlt')
    const category = readCategory(row.kategorie)
    if (!category) problems.push(row.kategorie ? `kategorie «${String(row.kategorie)}» unbekannt (${CATEGORIES.join(', ')})` : 'kategorie fehlt')
    const kg = readNumber(row.schlachtgewicht_kg)
    const price = readNumber(row.preis_kg)
    const amount = readNumber(row.betrag)
    for (const [f, r] of [['schlachtgewicht_kg', kg], ['preis_kg', price], ['betrag', amount]] as const) if (r.error) problems.push(`${f}: ${r.error}`)
    const tag = readText(row.ohrmarke)
    const key = tag ? animalKey(tag) : null
    if (tag && !key) problems.push(`ohrmarke «${tag}» nicht lesbar`)
    if (!tag) warnings.push('ohne Ohrmarke: zählt in den Auswertungen ohne Alter')
    const lim = category ? LIMITS[category] : undefined
    if (lim && kg.value != null && (kg.value < lim[0] || kg.value > lim[1])) warnings.push(`Schlachtgewicht ${kg.value} kg ungewöhnlich für ${category} (${lim[0]}–${lim[1]} kg)`)
    if (price.value != null && (price.value <= 0 || price.value > 40)) warnings.push(`Preis ${price.value} Fr./kg ungewöhnlich`)
    if (kg.value != null && price.value != null && amount.value != null && Math.abs(kg.value * price.value - amount.value) > 1) warnings.push(`Betrag ${amount.value} passt nicht zu ${kg.value} kg × ${price.value} Fr.`)
    const unknown = unknownFields(row, SLAUGHTER_FIELDS)
    if (unknown.length) warnings.push(`unbekannte Felder ignoriert: ${unknown.join(', ')}`)
    const dup = date.value && key ? `${date.value}|${key}` : null
    let status: CheckedRow['status'] = problems.length ? 'fehler' : 'neu'
    if (status === 'neu' && dup && known.has(dup)) {
      status = 'doppelt'
      problems.push('schon erfasst (gleiche Ohrmarke, gleicher Schlachttag)')
    } else if (status === 'neu' && dup && inBlock.has(dup)) {
      status = 'doppelt'
      problems.push('zweimal im eingefügten Block')
    }
    if (dup) inBlock.add(dup)
    const value: SlaughterValue = {
      slaughter_date: date.value ?? '',
      ear_tag: tag,
      animal_key: key,
      category: category ?? '',
      carcass_kg: kg.value,
      classification: readText(row.taxation)?.replace(/\s+/g, '').toUpperCase() ?? null,
      price_per_kg: price.value,
      amount: amount.value ?? (kg.value != null && price.value != null ? Math.round(kg.value * price.value * 100) / 100 : null),
      remark: readText(row.bemerkung),
      buyer: readText(row.abnehmer),
      settlement_no: readText(row.abrechnung),
      weigh_slip_no: readText(row.waagschein),
      notes: readText(row.notiz),
    }
    return {
      index,
      status,
      title: `${date.value ?? '?'} · ${category ?? '?'} · ${tag ?? 'ohne Ohrmarke'}`,
      detail: [kg.value != null ? `${kg.value} kg` : null, value.classification, price.value != null ? `${price.value.toFixed(2)} Fr./kg` : null, value.remark, value.buyer].filter(Boolean).join(' · '),
      problems,
      warnings,
      value,
    }
  })
}

async function loadExisting(db: PGlite) {
  const { rows } = await db.query<{ slaughter_date: unknown; animal_key: string | null }>('select slaughter_date, animal_key from slaughter_records where deleted_at is null')
  return rows.map((r) => ({ slaughter_date: r.slaughter_date instanceof Date ? r.slaughter_date.toISOString().slice(0, 10) : String(r.slaughter_date).slice(0, 10), animal_key: r.animal_key }))
}

export const slaughterPasteImporter: PasteImporter = {
  area: 'schlachtungen',
  label: 'Schlachtungen (Schlachtabrechnungen)',
  description:
    'Eine Zeile je geschlachtetes Tier aus der Abrechnung des Schlachtbetriebs oder Händlers: Lämmer, Schafe, Kälber, Rinder … ' +
    'Gleiche Ohrmarke am gleichen Schlachttag gilt als doppelt. Alter und Geschlecht holt die Auswertung aus den Tierlisten.',
  permission: 'livestock:slaughter:write',
  fields: SLAUGHTER_FIELDS,
  example: [
    { datum: '2026-08-27', kategorie: 'Lamm', ohrmarke: '9999.0001', schlachtgewicht_kg: 15.5, taxation: 'T2', preis_kg: 12, betrag: 186, abnehmer: 'Schlachtbetrieb', abrechnung: '100001' },
    { datum: '2026-08-27', kategorie: 'Schaf', ohrmarke: '9999.0002', schlachtgewicht_kg: 21, taxation: 'T1', preis_kg: 6.9, bemerkung: '' },
  ],
  check: async (db, rows) => checkSlaughter(rows, await loadExisting(db)),
  apply: async (db, rows) => {
    // gegen den aktuellen Stand: inzwischen Erfasstes nicht doppelt
    const existing = new Set((await loadExisting(db)).filter((e) => e.animal_key).map((e) => `${e.slaughter_date}|${e.animal_key}`))
    const out: Record<string, unknown>[] = []
    for (const r of rows) {
      const v = r.value as SlaughterValue
      if (v.animal_key && existing.has(`${v.slaughter_date}|${v.animal_key}`)) continue
      if (v.animal_key) existing.add(`${v.slaughter_date}|${v.animal_key}`)
      out.push({ id: crypto.randomUUID(), ...v, source: 'import', deleted_at: null })
    }
    if (out.length) await upsertRows('slaughter_records', out as never)
    return out.length
  },
}
