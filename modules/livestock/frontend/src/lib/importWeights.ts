import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

/** Generischer CSV-Parser mit Delimiter-Erkennung (Komma, Semikolon oder Tab
 * — deckt sowohl Schweizer/Excel-CSV-Exporte mit ';' als auch aus Excel
 * direkt kopierte Bereiche ab, die tab-getrennt in die Zwischenablage
 * kommen), kein Fixformat wie parseIntakeCsv. */
export function parseGenericCsv(text: string): ParsedCsv {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }

  const counts: Record<string, number> = {
    ',': (lines[0].match(/,/g) ?? []).length,
    ';': (lines[0].match(/;/g) ?? []).length,
    '\t': (lines[0].match(/\t/g) ?? []).length,
  }
  const delimiter = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ',') as string
  const split = (line: string) => line.split(delimiter).map((c) => c.trim())

  const [headerLine, ...dataLines] = lines
  return { headers: split(headerLine), rows: dataLines.map(split) }
}

const DATE_PATTERNS: Array<{ regex: RegExp; toIso: (m: RegExpMatchArray) => string }> = [
  { regex: /^(\d{4})-(\d{2})-(\d{2})$/, toIso: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  { regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, toIso: (m) => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` },
  {
    regex: /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/,
    toIso: (m) => `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
  },
]

/** Best-effort Versuch, ein Datum aus dem Spaltentitel zu lesen — nur ein
 * Vorschlag für die UI, der Nutzer kann das Datum pro Spalte überschreiben. */
export function guessDateFromHeader(header: string): string {
  const trimmed = header.trim()
  for (const { regex, toIso } of DATE_PATTERNS) {
    const m = trimmed.match(regex)
    if (m) return toIso(m)
  }
  return ''
}

export interface WeightColumnMapping {
  columnIndex: number
  date: string // YYYY-MM-DD
}

export interface ImportWeightsResult {
  imported: number
  unmatchedEarTags: string[]
  skippedCells: number
}

export async function importWeightsFromCsv(
  pg: PGlite,
  csv: ParsedCsv,
  earTagColumn: number,
  weightColumns: WeightColumnMapping[],
): Promise<ImportWeightsResult> {
  const { rows: animals } = await pg.query<{ id: string; ear_tag: string }>(
    'select id, ear_tag from animals where deleted_at is null',
  )
  const byEarTag = new Map(animals.map((a) => [a.ear_tag.toLowerCase(), a.id]))

  let imported = 0
  let skippedCells = 0
  const unmatched = new Set<string>()

  for (const row of csv.rows) {
    const earTag = row[earTagColumn]?.trim()
    if (!earTag) continue
    const animalId = byEarTag.get(earTag.toLowerCase())
    if (!animalId) {
      unmatched.add(earTag)
      continue
    }
    for (const col of weightColumns) {
      const raw = row[col.columnIndex]?.trim()
      if (!raw) continue
      const weight = Number(raw.replace(',', '.'))
      if (Number.isNaN(weight) || weight <= 0) {
        skippedCells++
        continue
      }
      await upsertRow('weighings', {
        id: crypto.randomUUID(),
        animal_id: animalId,
        date: col.date,
        weight_kg: weight,
        notes: null,
      })
      imported++
    }
  }

  return { imported, unmatchedEarTags: [...unmatched], skippedCells }
}
