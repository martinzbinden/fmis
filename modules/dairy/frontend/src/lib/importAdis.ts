// Parser für den ADIS-Herdebuch-Export ("Datenschnittstelle Rindvieh-Schweiz",
// Qualitas AG) — feste Satzlängen, eine Zeile pro Datensatz. Die Satzart steht
// in den ersten 3 Zeichen JEDER ZEILE, nicht im Dateinamen (z.B. enthält eine
// Datei mit der Endung .Y01 tatsächlich K01-Sätze). Unbekannte Satzarten
// werden einfach übersprungen (K05/K07-K11, B01/B04, CODE.C01, Y02, ...) —
// für die zwei MVP-Features werden nur K01 (Tier-Stammdaten) und K33 (alle
// Milchproben) gebraucht. Spaltenoffsets 1:1 aus der offiziellen Spec
// übernommen und gegen echte Exportdateien verifiziert.

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'
import type { AnimalSex, AnimalStatus } from '../types'

export interface ParsedAnimal {
  ear_tag: string
  name: string | null
  breed_code: string | null
  birth_date: string | null
  sex: AnimalSex | null
  status: AnimalStatus
  entry_date: string | null
  exit_date: string | null
}

export interface ParsedMilkTest {
  ear_tag: string
  test_date: string
  calving_date: string | null
  lactation_number: number | null
  milk_kg: number
  fat_pct: number
  protein_pct: number
  lactose_pct: number | null
  cell_count: number | null
  urea_mg_dl: number | null
}

export interface ParseResult {
  animals: ParsedAnimal[]
  milkTests: ParsedMilkTest[]
  warnings: string[]
  ignoredLines: number
}

function field(line: string, from: number, to: number): string {
  // from/to sind 1-indexierte, inklusive Spaltenpositionen aus der Spec.
  return line.slice(from - 1, to)
}

function trimmed(s: string): string | null {
  const t = s.trim()
  return t === '' ? null : t
}

function parseAdisDate(s: string): string | null {
  const t = s.trim()
  if (t.length !== 8) return null
  const year = t.slice(0, 4)
  const month = t.slice(4, 6)
  const day = t.slice(6, 8)
  return `${year}-${month}-${day}`
}

function parseAdisNumber(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isNaN(n) ? null : n
}

function parseAdisInt(s: string): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number.parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}

function parseK01Line(line: string): ParsedAnimal | null {
  const ear_tag = trimmed(field(line, 23, 36))
  if (!ear_tag) return null
  const exit_date = parseAdisDate(field(line, 138, 145))
  const sexCode = field(line, 112, 112)
  return {
    ear_tag,
    name: trimmed(field(line, 40, 51)),
    breed_code: trimmed(field(line, 37, 39)),
    birth_date: parseAdisDate(field(line, 52, 59)),
    sex: sexCode === '1' ? 'm' : sexCode === '2' ? 'w' : null,
    status: exit_date ? 'abgegangen' : 'aktiv',
    entry_date: parseAdisDate(field(line, 130, 137)),
    exit_date,
  }
}

function parseK33Line(line: string): ParsedMilkTest | null {
  const ear_tag = trimmed(field(line, 23, 36))
  const test_date = parseAdisDate(field(line, 82, 89))
  const milk_kg = parseAdisNumber(field(line, 90, 93))
  const fat_pct = parseAdisNumber(field(line, 94, 97))
  const protein_pct = parseAdisNumber(field(line, 98, 101))
  if (!ear_tag || !test_date || milk_kg == null || fat_pct == null || protein_pct == null) {
    return null
  }
  return {
    ear_tag,
    test_date,
    calving_date: parseAdisDate(field(line, 69, 76)),
    lactation_number: parseAdisInt(field(line, 77, 78)),
    milk_kg,
    fat_pct,
    protein_pct,
    lactose_pct: parseAdisNumber(field(line, 102, 105)),
    cell_count: parseAdisInt(field(line, 109, 112)),
    urea_mg_dl: parseAdisInt(field(line, 113, 115)),
  }
}

export function parseAdisFiles(files: { name: string; text: string }[]): ParseResult {
  const animals: ParsedAnimal[] = []
  const milkTests: ParsedMilkTest[] = []
  const warnings: string[] = []
  let ignoredLines = 0

  for (const file of files) {
    const lines = file.text.split(/\r?\n/).filter((l) => l.trim() !== '')
    for (const line of lines) {
      const tag = line.slice(0, 3)
      if (tag === 'K01') {
        const parsed = parseK01Line(line)
        if (parsed) animals.push(parsed)
        else warnings.push(`${file.name}: K01-Zeile ohne Ohrmarke übersprungen`)
      } else if (tag === 'K33') {
        const parsed = parseK33Line(line)
        if (parsed) milkTests.push(parsed)
        else warnings.push(`${file.name}: K33-Zeile mit fehlenden Pflichtwerten übersprungen`)
      } else {
        ignoredLines++
      }
    }
  }

  return { animals, milkTests, warnings, ignoredLines }
}

export interface ImportSummary {
  animalsImported: number
  milkTestsImported: number
  unmatchedEarTags: string[]
}

/**
 * Importiert das Parse-Ergebnis in pglite: erst alle Tiere (K01) upserten
 * (per ear_tag mit bestehenden Tieren abgleichen, damit ein wiederholter
 * Import keine Duplikate erzeugt), dann alle Milchtests (K33) — dedupliziert
 * über (animal_id, test_date), da ein Test pro Kuh und Tag eindeutig ist.
 */
export async function importAdisData(pg: PGlite, parsed: ParseResult): Promise<ImportSummary> {
  const { rows: existingAnimals } = await pg.query<{ id: string; ear_tag: string }>(
    'select id, ear_tag from animals',
  )
  const earTagToId = new Map(existingAnimals.map((a) => [a.ear_tag, a.id]))

  for (const animal of parsed.animals) {
    const id = earTagToId.get(animal.ear_tag) ?? crypto.randomUUID()
    earTagToId.set(animal.ear_tag, id)
    await upsertRow('animals', { id, ...animal })
  }

  const { rows: existingTests } = await pg.query<{ id: string; animal_id: string; test_date: string }>(
    'select id, animal_id, test_date from milk_tests',
  )
  const testKeyToId = new Map(existingTests.map((t) => [`${t.animal_id}|${t.test_date}`, t.id]))

  const unmatchedEarTags = new Set<string>()
  let milkTestsImported = 0
  for (const test of parsed.milkTests) {
    const animalId = earTagToId.get(test.ear_tag)
    if (!animalId) {
      unmatchedEarTags.add(test.ear_tag)
      continue
    }
    const key = `${animalId}|${test.test_date}`
    const id = testKeyToId.get(key) ?? crypto.randomUUID()
    testKeyToId.set(key, id)
    const { ear_tag: _earTag, ...rest } = test
    await upsertRow('milk_tests', { id, animal_id: animalId, ...rest })
    milkTestsImported++
  }

  return {
    animalsImported: parsed.animals.length,
    milkTestsImported,
    unmatchedEarTags: [...unmatchedEarTags],
  }
}
