// Parser für den ADIS-Herdebuch-Export ("Datenschnittstelle Rindvieh-Schweiz",
// Qualitas AG) — feste Satzlängen, eine Zeile pro Datensatz. Die Satzart steht
// in den ersten 3 Zeichen JEDER ZEILE, nicht im Dateinamen (z.B. enthält eine
// Datei mit der Endung .Y01 tatsächlich K01-Sätze). Unbekannte Satzarten
// werden einfach übersprungen (K05/K07-K11, B01/B04, CODE.C01, Y02, ...) —
// gebraucht werden K01 (Tier-Stammdaten), K33 (alle Milchproben) und K04
// (Laktationsdaten). Spaltenoffsets 1:1 aus der offiziellen Spec übernommen
// und gegen echte Exportdateien verifiziert.

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'
import type { AnimalSex, AnimalStatus, LactationClosureType } from '../types'

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

export interface ParsedLactation {
  ear_tag: string
  lactation_number: number
  calving_date: string | null
  closure_type: LactationClosureType
  days_in_milk: number | null
  milk_kg: number | null
  fat_kg: number | null
  fat_pct: number | null
  protein_kg: number | null
  protein_pct: number | null
}

export interface ParseResult {
  animals: ParsedAnimal[]
  milkTests: ParsedMilkTest[]
  lactations: ParsedLactation[]
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

function parseK04Line(line: string): ParsedLactation | null {
  const ear_tag = trimmed(field(line, 23, 36))
  const lactation_number = parseAdisInt(field(line, 69, 70))
  const closure_type = parseAdisInt(field(line, 84, 84))
  const milk_kg = parseAdisInt(field(line, 89, 93))
  // Die Tier-Kopfzeile (Laktationsnummer 0, keine Werte) wird hier über das
  // fehlende milk_kg herausgefiltert, wie bei K33 auch.
  if (!ear_tag || lactation_number == null || closure_type == null || milk_kg == null) {
    return null
  }
  return {
    ear_tag,
    lactation_number,
    calving_date: parseAdisDate(field(line, 71, 78)),
    closure_type: closure_type as LactationClosureType,
    days_in_milk: parseAdisInt(field(line, 85, 88)),
    milk_kg,
    fat_kg: parseAdisInt(field(line, 94, 97)),
    fat_pct: parseAdisNumber(field(line, 98, 101)),
    protein_kg: parseAdisInt(field(line, 102, 105)),
    protein_pct: parseAdisNumber(field(line, 106, 109)),
  }
}

export function parseAdisFiles(files: { name: string; text: string }[]): ParseResult {
  const animals: ParsedAnimal[] = []
  const milkTests: ParsedMilkTest[] = []
  const lactations: ParsedLactation[] = []
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
      } else if (tag === 'K04') {
        const parsed = parseK04Line(line)
        if (parsed) lactations.push(parsed)
        // Keine Warnung bei null: die häufige Tier-Kopfzeile (Laktation 0)
        // wäre sonst pro Tier eine Warnung, ohne echten Informationswert.
      } else {
        ignoredLines++
      }
    }
  }

  return { animals, milkTests, lactations, warnings, ignoredLines }
}

export interface ImportSummary {
  animalsImported: number
  milkTestsImported: number
  lactationsImported: number
  unmatchedEarTags: string[]
}

/**
 * Importiert das Parse-Ergebnis in pglite: erst alle Tiere (K01) upserten
 * (per ear_tag mit bestehenden Tieren abgleichen, damit ein wiederholter
 * Import keine Duplikate erzeugt), dann alle Milchtests (K33) — dedupliziert
 * über (animal_id, test_date), da ein Test pro Kuh und Tag eindeutig ist —
 * und zuletzt alle Laktationsdaten (K04), dedupliziert über (animal_id,
 * lactation_number, closure_type): mehrere Zeilen pro Laktation mit
 * unterschiedlicher Abschlussart sind gewollt (siehe schema/0003_lactations.sql).
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

  const { rows: existingLactations } = await pg.query<{
    id: string
    animal_id: string
    lactation_number: number
    closure_type: number
  }>('select id, animal_id, lactation_number, closure_type from lactations')
  const lactationKeyToId = new Map(
    existingLactations.map((l) => [`${l.animal_id}|${l.lactation_number}|${l.closure_type}`, l.id]),
  )

  let lactationsImported = 0
  for (const lactation of parsed.lactations) {
    const animalId = earTagToId.get(lactation.ear_tag)
    if (!animalId) {
      unmatchedEarTags.add(lactation.ear_tag)
      continue
    }
    const key = `${animalId}|${lactation.lactation_number}|${lactation.closure_type}`
    const id = lactationKeyToId.get(key) ?? crypto.randomUUID()
    lactationKeyToId.set(key, id)
    const { ear_tag: _earTag, ...rest } = lactation
    await upsertRow('lactations', { id, animal_id: animalId, ...rest })
    lactationsImported++
  }

  return {
    animalsImported: parsed.animals.length,
    milkTestsImported,
    lactationsImported,
    unmatchedEarTags: [...unmatchedEarTags],
  }
}
