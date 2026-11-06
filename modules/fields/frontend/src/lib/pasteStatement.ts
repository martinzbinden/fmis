// «Strukturierte Daten einfügen» für die Abrechnungen der Direktzahlungen: je Detailzeile
// der Abrechnung ein Datensatz. Doppelte (gleicher Betrieb, Jahr, Abschnitt, Bezeichnung,
// Zone) werden erkannt und übersprungen.

import type { PGlite } from '@electric-sql/pglite'
import { readNumber, readText, unknownFields, type CheckedRow, type PasteField, type PasteImporter } from '@fmis/core/pasteImport'
import { upsertRows } from '../db/write'
import { DP_STATEMENT_SECTIONS } from './directPayments'

export const STATEMENT_FIELDS: PasteField[] = [
  { name: 'betrieb', required: true, type: 'Text', description: 'Name des Betriebs wie in FMIS' },
  { name: 'jahr', required: true, type: 'Zahl', description: 'Beitragsjahr' },
  { name: 'abschnitt', required: true, type: 'Text', description: DP_STATEMENT_SECTIONS.join(', ') },
  { name: 'bezeichnung', required: true, type: 'Text', description: 'Bezeichnung wie in der Abrechnung' },
  { name: 'zone', type: 'Text', description: 'Zonencode wie in der Abrechnung, z.B. 51' },
  { name: 'anzahl', type: 'Zahl', description: 'Aren, Bäume oder GVE' },
  { name: 'ansatz', type: 'Zahl', description: 'Ansatz je Einheit' },
  { name: 'faktor', type: 'Zahl', description: 'Faktor' },
  { name: 'betrag', required: true, type: 'Zahl', description: 'Betrag in Franken' },
]

export interface StatementValue {
  farm_id: string
  jahr: number
  section: string
  label: string
  zone: string | null
  quantity: number | null
  rate: number | null
  factor: number | null
  amount: number
}

interface FarmRow {
  id: string
  name: string
}
interface LineRow {
  farm_id: string
  jahr: number
  section: string
  label: string
  zone: string | null
}

const keyOf = (v: LineRow) => [v.farm_id, v.jahr, v.section, v.label, v.zone ?? ''].join('|')

export function checkStatement(rows: Record<string, unknown>[], farms: FarmRow[], existing: LineRow[]): CheckedRow[] {
  const known = new Set(existing.map(keyOf))
  const seen = new Set<string>()
  return rows.map((row, index) => {
    const problems: string[] = []
    const warnings: string[] = []
    const extra = unknownFields(row, STATEMENT_FIELDS)
    if (extra.length) warnings.push(`unbekannte Felder ignoriert: ${extra.join(', ')}`)

    const name = readText(row.betrieb)
    const farm = farms.find((f) => f.name.toLowerCase() === name?.toLowerCase())
    if (!name) problems.push('betrieb fehlt')
    else if (!farm) problems.push(`Betrieb «${name}» nicht gefunden`)

    const number = (field: string) => {
      const n = readNumber(row[field])
      if (n.error) problems.push(`${field}: ${n.error}`)
      return n.value
    }
    const jahr = number('jahr')
    if (jahr == null || !Number.isInteger(jahr)) problems.push('jahr fehlt')
    const section = readText(row.abschnitt)
    if (!section) problems.push('abschnitt fehlt')
    else if (!DP_STATEMENT_SECTIONS.includes(section)) problems.push(`abschnitt «${section}» unbekannt`)
    const label = readText(row.bezeichnung)
    if (!label) problems.push('bezeichnung fehlt')
    const quantity = number('anzahl')
    const rate = number('ansatz')
    const factor = number('faktor')
    const amount = number('betrag')
    if (amount == null) problems.push('betrag fehlt')

    const value: StatementValue = {
      farm_id: farm?.id ?? '',
      jahr: jahr ?? 0,
      section: section ?? '',
      label: label ?? '',
      zone: readText(row.zone),
      quantity,
      rate,
      factor,
      amount: amount ?? 0,
    }
    let status: CheckedRow['status'] = problems.length ? 'fehler' : 'neu'
    if (status === 'neu') {
      const key = keyOf(value)
      if (known.has(key) || seen.has(key)) {
        status = 'doppelt'
        problems.push(known.has(key) ? 'bereits erfasst' : 'doppelt im Block')
      }
      seen.add(key)
    }
    return {
      index,
      status,
      title: `${name ?? '?'} ${jahr ?? ''} · ${label ?? '?'}${value.zone ? ` · Zone ${value.zone}` : ''}`,
      detail: amount != null ? `${amount.toFixed(2)} Fr.` : undefined,
      problems,
      warnings,
      value,
    }
  })
}

async function loadForCheck(db: PGlite) {
  const [farms, lines] = await Promise.all([
    db.query<FarmRow>('select id, name from farms where deleted_at is null'),
    db.query<LineRow>('select farm_id, jahr, section, label, zone from dp_statement_lines where deleted_at is null'),
  ])
  return { farms: farms.rows, lines: lines.rows }
}

export const statementPasteImporter: PasteImporter = {
  area: 'abrechnung',
  label: 'Direktzahlungen: Abrechnung des Kantons',
  description: 'Je Detailzeile der Abrechnung ein Datensatz. Der Rechner nimmt daraus Vernetzung, Landschaftsqualität, GVE, Hanglagen und Qualitätsstufe II.',
  permission: 'fields:dz:write',
  fields: STATEMENT_FIELDS,
  example: [{ betrieb: 'Mein Betrieb', jahr: 2025, abschnitt: 'offenhaltung', bezeichnung: 'Offenhaltungsbeitrag', zone: '51', anzahl: 100, ansatz: 2.3, faktor: 1, betrag: 230 }],
  check: async (db, rows) => {
    const { farms, lines } = await loadForCheck(db)
    return checkStatement(rows, farms, lines)
  },
  apply: async (db, rows) => {
    // gegen den aktuellen Stand: inzwischen Erfasstes nicht doppelt
    const { lines } = await loadForCheck(db)
    const known = new Set(lines.map(keyOf))
    const fresh = rows.map((r) => r.value as StatementValue).filter((v) => !known.has(keyOf(v)))
    if (fresh.length) await upsertRows('dp_statement_lines', fresh.map((v) => ({ id: crypto.randomUUID(), ...v, deleted_at: null })) as never)
    return fresh.length
  },
}
