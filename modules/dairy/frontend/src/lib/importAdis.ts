// Parser für den Herdebuch-Export ("Datenschnittstelle Rindvieh-Schweiz",
// Qualitas AG) — feste Satzlängen, eine Zeile pro Datensatz. Die Satzart steht
// in den ersten 3 Zeichen JEDER ZEILE, nicht im Dateinamen (z.B. enthält eine
// Datei mit der Endung .Y01 tatsächlich K01-Sätze, .Y02 K02-Sätze). Gilt für
// beide Instanzen: der SMG-Export der Milchschafe folgt derselben Spec, nur
// K09 (Zuchtwerte) weicht ab, siehe lib/herdbookRecords.ts.
// Gelesen werden K01 (Tier-Stammdaten + Eltern), K02 (drei Generationen),
// K33 (Milchproben), K04 (Laktationen), K09 (Zuchtwerte), K10 (Belegungen)
// und K11 (Geburten); übrige Satzarten (K03/K05/K07/K08/K44/K45/K16,
// B01/B04, CODE.C01) werden übersprungen. Spaltenoffsets 1:1 aus der
// offiziellen Spec übernommen und gegen echte Exportdateien verifiziert.

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import type { SyncTable } from '../db/tables'
import type { AnimalSex, AnimalStatus, LactationClosureType } from '../types'
import { animalKey } from '@fmis/core/earTag'
import {
  mergePedigree,
  parseK01Pedigree,
  parseK02Pedigree,
  parseK09Cattle,
  parseK09Sheep,
  parseK10,
  parseK11,
  type ParsedBirthLine,
  type ParsedBreedingValue,
  type ParsedMating,
  type PedigreeEntry,
} from './herdbookRecords'

export type HerdbookSpecies = 'cattle' | 'sheep'

/** Herdebuch-Dateien sind Latin-1; File.text() würde als UTF-8 dekodieren
 * und Umlaute in Namen zerstören. windows-1252 deckt Latin-1 ab. */
export async function readHerdbookFile(file: File): Promise<{ name: string; text: string }> {
  const buf = await file.arrayBuffer()
  return { name: file.name, text: new TextDecoder('windows-1252').decode(buf) }
}

export interface ParsedAnimal {
  ear_tag: string
  name: string | null
  breed_code: string | null
  birth_date: string | null
  sex: AnimalSex | null
  status: AnimalStatus
  entry_date: string | null
  exit_date: string | null
  lauf_nr: string | null   // "Laufnummer in Herde" (K01 283-286)
}

export interface ParsedMilkTest {
  ear_tag: string
  test_date: string
  calving_date: string | null
  lactation_number: number | null
  milk_kg: number
  // null = Wägung ohne Laboranalyse (nur kg Milch), siehe schema/0004.
  fat_pct: number | null
  protein_pct: number | null
  lactose_pct: number | null
  cell_count: number | null
  urea_mg_dl: number | null
  // Prüfbericht-Felder (schema/0008_test_details.sql)
  milk_morning_kg: number | null
  milk_evening_kg: number | null
  sample_persistency: number | null
  bhb_mmol: number | null
  acetone_mmol: number | null
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
  cell_count: number | null
  persistency: number | null
}

export interface ParseResult {
  animals: ParsedAnimal[]
  milkTests: ParsedMilkTest[]
  lactations: ParsedLactation[]
  pedigree: PedigreeEntry[]
  matings: ParsedMating[]
  births: ParsedBirthLine[]
  breedingValues: ParsedBreedingValue[]
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
    lauf_nr: trimmed(field(line, 283, 286)),
  }
}

function parseK33Line(line: string): ParsedMilkTest | null {
  const ear_tag = trimmed(field(line, 23, 36))
  const test_date = parseAdisDate(field(line, 82, 89))
  const milk_kg = parseAdisNumber(field(line, 90, 93))
  const fat_pct = parseAdisNumber(field(line, 94, 97))
  const protein_pct = parseAdisNumber(field(line, 98, 101))
  // Fett/Eiweiss dürfen fehlen (Wägung ohne Laboranalyse) — nur Ohrmarke,
  // Datum und Milchmenge sind Pflicht.
  if (!ear_tag || !test_date || milk_kg == null) {
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
    sample_persistency: parseAdisInt(field(line, 106, 108)),
    milk_morning_kg: parseAdisNumber(field(line, 130, 133)),
    milk_evening_kg: parseAdisNumber(field(line, 134, 137)),
    acetone_mmol: parseAdisNumber(field(line, 184, 187)),
    bhb_mmol: parseAdisNumber(field(line, 188, 191)),
  }
}

function parseK04Line(line: string): ParsedLactation | null {
  const ear_tag = trimmed(field(line, 23, 36))
  const lactation_number = parseAdisInt(field(line, 69, 70))
  const closure_type = parseAdisInt(field(line, 84, 84))
  const milk_kg = parseAdisInt(field(line, 89, 93))
  // Die Tier-Kopfzeile hat Laktationsnummer 0. Eine abgeschlossene Laktation
  // OHNE Milchmenge (z.B. nach Verwerfen) bleibt dagegen erhalten — sie zählt
  // für die Laktationszahl und damit für die Altersstandardisierung (siehe
  // lib/herdPerformance.ts), genau wie im bisherigen Selektionsablauf.
  if (!ear_tag || lactation_number == null || lactation_number === 0 || closure_type == null) {
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
    cell_count: parseAdisInt(field(line, 114, 118)),
    persistency: parseAdisInt(field(line, 122, 124)),
  }
}

export function parseAdisFiles(files: { name: string; text: string }[], species: HerdbookSpecies = 'cattle'): ParseResult {
  const animals: ParsedAnimal[] = []
  const milkTests: ParsedMilkTest[] = []
  const lactations: ParsedLactation[] = []
  const pedigreeEntries: PedigreeEntry[] = []
  const matings: ParsedMating[] = []
  const births: ParsedBirthLine[] = []
  const breedingValues: ParsedBreedingValue[] = []
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
        const ped = parseK01Pedigree(line)
        if (ped) pedigreeEntries.push(ped)
      } else if (tag === 'K02') {
        pedigreeEntries.push(...parseK02Pedigree(line))
      } else if (tag === 'K09') {
        breedingValues.push(...(species === 'sheep' ? parseK09Sheep(line) : parseK09Cattle(line)))
      } else if (tag === 'K10') {
        const parsed = parseK10(line)
        if (parsed) matings.push(parsed)
        else warnings.push(`${file.name}: K10-Zeile ohne Tier oder Datum übersprungen`)
      } else if (tag === 'K11') {
        const parsed = parseK11(line)
        if (parsed) births.push(parsed)
        else warnings.push(`${file.name}: K11-Zeile ohne Muttertier oder Datum übersprungen`)
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

  // Väter aus Belegungen/Geburten und die Nachkommen selbst gehören ebenfalls
  // in den Stammbaum — sonst fehlt z.B. bei einem Lamm, das nie in K01/K02
  // auftaucht, die Verbindung zu seinen Eltern.
  for (const m of matings) {
    const key = animalKey(m.sire_ear_tag)
    if (key && m.sire_ear_tag) {
      pedigreeEntries.push({
        key, ear_tag: m.sire_ear_tag, sire_key: null, dam_key: null,
        breed_code: m.sire_breed, name: m.sire_name, birth_date: null, sex: 'm',
      })
    }
  }
  for (const b of births) {
    const key = animalKey(b.offspring_ear_tag)
    if (key && b.offspring_ear_tag) {
      pedigreeEntries.push({
        key, ear_tag: b.offspring_ear_tag, sire_key: animalKey(b.sire_ear_tag),
        dam_key: animalKey(b.dam_ear_tag), breed_code: null, name: null,
        birth_date: b.birth_date, sex: b.offspring_sex,
      })
    }
  }

  return {
    animals,
    milkTests,
    lactations,
    pedigree: mergePedigree(pedigreeEntries),
    matings,
    births,
    breedingValues,
    warnings,
    ignoredLines,
  }
}

export interface ImportSummary {
  animalsImported: number
  milkTestsImported: number
  lactationsImported: number
  pedigreeWritten: number
  matingsWritten: number
  birthsWritten: number
  offspringWritten: number
  breedingValuesWritten: number
  unmatchedEarTags: string[]
}

function sqlDate(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a == null || a === '') return b == null || b === ''
  if (b == null || b === '') return false
  // pglite liefert date-Spalten als Date (UTC-Mitternacht), numeric als string.
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
  const x = norm(a)
  const y = norm(b)
  if (typeof x === 'boolean' || typeof y === 'boolean') return Boolean(x) === Boolean(y)
  const nx = Number(x)
  const ny = Number(y)
  if (!Number.isNaN(nx) && !Number.isNaN(ny) && String(x).trim() !== '' && String(y).trim() !== '') return nx === ny
  return String(x) === String(y)
}

/** upsertRow nur, wenn sich ein Feld gegenüber der bestehenden Zeile ändert —
 * ein wiederholter Import des gleichen Exports soll weder den Sync noch die
 * Änderungshistorie mit hunderten unveränderten Zeilen füllen. */
async function writeIfChanged(
  pg: PGlite,
  table: SyncTable,
  row: Record<string, unknown> & { id: string },
  prev: Record<string, unknown> | undefined,
): Promise<boolean> {
  if (prev && Object.keys(row).every((k) => sameValue(row[k], prev[k]))) return false
  await upsertRow(pg, table, row as never)
  return true
}

async function loadByKey(pg: PGlite, table: string, keyColumn: string): Promise<Map<string, Record<string, unknown>>> {
  const { rows } = await pg.query<Record<string, unknown>>(`select * from "${table}" where ${keyColumn} is not null`)
  return new Map(rows.map((r) => [String(r[keyColumn]), r]))
}

/** Abstammung, Belegungen, Geburten und Zuchtwerte schreiben. Bereits in der
 * App gelöschte Zeilen (deleted_at) werden nicht wiederbelebt; von Hand
 * erfasste Stammbaum-Einträge (source 'manual') nur in leeren Feldern
 * ergänzt. */
async function importBreedingData(
  pg: PGlite,
  parsed: ParseResult,
  animalIdByKey: Map<string, string>,
  unmatched: Set<string>,
) {
  let pedigreeWritten = 0
  const pedigreeByKey = await loadByKey(pg, 'pedigree', 'animal_key')
  for (const e of parsed.pedigree) {
    const prev = pedigreeByKey.get(e.key)
    if (prev?.deleted_at) continue
    const base = {
      animal_key: e.key, ear_tag: e.ear_tag, sire_key: e.sire_key, dam_key: e.dam_key,
      breed_code: e.breed_code, name: e.name, birth_date: e.birth_date, sex: e.sex,
    }
    let row: Record<string, unknown> & { id: string }
    if (prev && prev.source === 'manual') {
      row = { ...prev, id: String(prev.id) }
      for (const [k, v] of Object.entries(base)) if (row[k] == null && v != null) row[k] = v
    } else {
      row = { id: prev ? String(prev.id) : crypto.randomUUID(), ...base, source: 'import' }
    }
    if (await writeIfChanged(pg, 'pedigree', row, prev)) pedigreeWritten++
  }

  let matingsWritten = 0
  const matingsByKey = await loadByKey(pg, 'matings', 'import_key')
  for (const m of parsed.matings) {
    const damKey = animalKey(m.ear_tag)
    const animalId = damKey ? animalIdByKey.get(damKey) : undefined
    if (!animalId || !damKey) {
      unmatched.add(m.ear_tag)
      continue
    }
    const sireKey = animalKey(m.sire_ear_tag)
    const importKey = `${damKey}|${m.service_date}|${m.seq ?? ''}|${sireKey ?? ''}`
    const prev = matingsByKey.get(importKey)
    if (prev?.deleted_at) continue
    const row = {
      id: prev ? String(prev.id) : crypto.randomUUID(),
      animal_id: animalId,
      service_date: m.service_date,
      service_to: m.service_to,
      kind: m.kind,
      seq: m.seq,
      sire_key: sireKey,
      sire_ear_tag: m.sire_ear_tag,
      sire_name: m.sire_name,
      sire_breed: m.sire_breed,
      source: 'import',
      import_key: importKey,
      notes: prev?.notes ?? null,
    }
    if (await writeIfChanged(pg, 'matings', row, prev)) matingsWritten++
  }

  // Geburten: K11 hat eine Zeile je Nachkomme — Ereignis = Muttertier + Datum.
  const events = new Map<string, ParsedBirthLine[]>()
  for (const b of parsed.births) {
    const damKey = animalKey(b.dam_ear_tag)
    if (!damKey) continue
    const k = `${damKey}|${b.birth_date}`
    events.set(k, [...(events.get(k) ?? []), b])
  }
  let birthsWritten = 0
  let offspringWritten = 0
  const birthsByKey = await loadByKey(pg, 'births', 'import_key')
  const offspringByKey = await loadByKey(pg, 'birth_offspring', 'import_key')
  for (const [importKey, lines] of events) {
    const first = lines[0]
    const damKey = importKey.split('|')[0]
    const damId = animalIdByKey.get(damKey)
    if (!damId) {
      unmatched.add(first.dam_ear_tag)
      continue
    }
    const prev = birthsByKey.get(importKey)
    if (prev?.deleted_at) continue
    const sireLine = lines.find((l) => l.sire_ear_tag) ?? first
    const birthId = prev ? String(prev.id) : crypto.randomUUID()
    const row = {
      id: birthId,
      dam_id: damId,
      birth_date: first.birth_date,
      parity: first.parity,
      sire_key: animalKey(sireLine.sire_ear_tag),
      sire_ear_tag: sireLine.sire_ear_tag,
      sire_name: (prev?.sire_name as string | null) ?? null,
      ease: first.ease,
      conception_date: lines.find((l) => l.conception_date)?.conception_date ?? null,
      source: 'import',
      import_key: importKey,
      notes: prev?.notes ?? null,
    }
    if (await writeIfChanged(pg, 'births', row, prev)) birthsWritten++

    for (const [i, l] of lines.entries()) {
      const offKey = animalKey(l.offspring_ear_tag)
      const offImportKey = `${importKey}|${offKey ?? `#${i}`}`
      const prevOff = offspringByKey.get(offImportKey)
      if (prevOff?.deleted_at) continue
      const offRow = {
        id: prevOff ? String(prevOff.id) : crypto.randomUUID(),
        birth_id: birthId,
        ear_tag: l.offspring_ear_tag,
        animal_key: offKey,
        sex: l.offspring_sex,
        stillborn: l.stillborn,
        died_24h: l.died_24h,
        birth_weight_kg: l.birth_weight_kg,
        import_key: offImportKey,
      }
      if (await writeIfChanged(pg, 'birth_offspring', offRow, prevOff)) offspringWritten++
    }
  }

  let breedingValuesWritten = 0
  const bvByKey = await loadByKey(pg, 'breeding_values', 'import_key')
  for (const bv of parsed.breedingValues) {
    const key = animalKey(bv.ear_tag)
    const animalId = key ? animalIdByKey.get(key) : undefined
    if (!animalId || !key) {
      unmatched.add(bv.ear_tag)
      continue
    }
    const importKey = `${key}|${bv.eval_date}|${bv.trait}`
    const prev = bvByKey.get(importKey)
    if (prev?.deleted_at) continue
    const row = {
      id: prev ? String(prev.id) : crypto.randomUUID(),
      animal_id: animalId,
      eval_date: bv.eval_date,
      trait: bv.trait,
      value: bv.value,
      reliability: bv.reliability,
      base: bv.base,
      import_key: importKey,
    }
    if (await writeIfChanged(pg, 'breeding_values', row, prev)) breedingValuesWritten++
  }

  return { pedigreeWritten, matingsWritten, birthsWritten, offspringWritten, breedingValuesWritten }
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
  // Eine Transaktion für den ganzen Import (siehe db/transaction.ts) — beim
  // vollständigen Schaf-Export (~3000 Zeilen) Sekunden statt Minuten.
  return inTransaction(pg, (tx) => importAdisDataIn(tx, parsed))
}

async function importAdisDataIn(pg: PGlite, parsed: ParseResult): Promise<ImportSummary> {
  const { rows: existingAnimals } = await pg.query<Record<string, unknown> & { id: string; ear_tag: string }>(
    'select * from animals',
  )
  // Abgleich über den normalisierten Schlüssel (lib/animalId.ts): ein Schaf,
  // das via TVD-Tierbestand in der Kurzform angelegt wurde, ist dasselbe Tier
  // wie im Herdebuch-Export in der Langform — kein Duplikat anlegen.
  const existingByKey = new Map(existingAnimals.map((a) => [animalKey(a.ear_tag) ?? a.ear_tag, a]))
  const animalIdByKey = new Map(existingAnimals.map((a) => [animalKey(a.ear_tag) ?? a.ear_tag, a.id]))
  const earTagToId = new Map(existingAnimals.map((a) => [a.ear_tag, a.id]))

  for (const animal of parsed.animals) {
    const key = animalKey(animal.ear_tag) ?? animal.ear_tag
    const prev = existingByKey.get(key)
    const id = prev?.id ?? crypto.randomUUID()
    animalIdByKey.set(key, id)
    earTagToId.set(animal.ear_tag, id)
    // In der App gepflegte Felder (Bemerkung, Laufnummer) beim Re-Import nicht
    // überschreiben, wenn der Export nichts dazu liefert.
    const row = {
      id,
      ...animal,
      lauf_nr: animal.lauf_nr ?? (prev?.lauf_nr as string | null) ?? null,
      notes: (prev?.notes as string | null) ?? null,
    }
    await writeIfChanged(pg, 'animals', row, prev)
  }

  const idFor = (earTag: string) => animalIdByKey.get(animalKey(earTag) ?? earTag) ?? earTagToId.get(earTag)

  const { rows: existingTests } = await pg.query<Record<string, unknown> & { id: string }>('select * from milk_tests')
  const testByKey = new Map(existingTests.map((t) => [`${t.animal_id}|${sqlDate(t.test_date)}`, t]))

  const unmatchedEarTags = new Set<string>()
  let milkTestsImported = 0
  for (const test of parsed.milkTests) {
    const animalId = idFor(test.ear_tag)
    if (!animalId) {
      unmatchedEarTags.add(test.ear_tag)
      continue
    }
    const key = `${animalId}|${test.test_date}`
    const prev = testByKey.get(key)
    const { ear_tag: _earTag, ...rest } = test
    const row = { id: prev?.id ?? crypto.randomUUID(), animal_id: animalId, ...rest }
    testByKey.set(key, row)
    await writeIfChanged(pg, 'milk_tests', row, prev)
    milkTestsImported++
  }

  const { rows: existingLactations } = await pg.query<Record<string, unknown> & { id: string }>('select * from lactations')
  const lactationByKey = new Map(
    existingLactations.map((l) => [`${l.animal_id}|${l.lactation_number}|${l.closure_type}`, l]),
  )

  let lactationsImported = 0
  for (const lactation of parsed.lactations) {
    const animalId = idFor(lactation.ear_tag)
    if (!animalId) {
      unmatchedEarTags.add(lactation.ear_tag)
      continue
    }
    const key = `${animalId}|${lactation.lactation_number}|${lactation.closure_type}`
    const prev = lactationByKey.get(key)
    const { ear_tag: _earTag, ...rest } = lactation
    const row = { id: prev?.id ?? crypto.randomUUID(), animal_id: animalId, ...rest }
    lactationByKey.set(key, row)
    await writeIfChanged(pg, 'lactations', row, prev)
    lactationsImported++
  }

  const breeding = await importBreedingData(pg, parsed, animalIdByKey, unmatchedEarTags)

  return {
    animalsImported: parsed.animals.length,
    milkTestsImported,
    lactationsImported,
    ...breeding,
    unmatchedEarTags: [...unmatchedEarTags],
  }
}
