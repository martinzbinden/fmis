// Parser für die Milchschafe-Stammdaten: zwei unabhängige Quellen, die
// zusammen den vollständigen, aktuellen Tierbestand ergeben (siehe
// project_instantiable_modules-Planung für die Herleitung):
//
// - Schaf-Tierbestand.xlsx (TVD-Tierbestand): Basis für ALLE aktuellen Tiere
//   inkl. Jungtiere/Widder — liefert die offizielle, kurze Ohrmarke
//   ("CH20041511") direkt.
// - b<Betrieb>.K04/.K33 (SMG-Zuchtorganisationsexport, fixed-width, Latin-1):
//   Anreicherung mit Laktationen/Milchkontrollen für die Tiere, die bereits
//   Milchleistungsdaten haben. Feldpositionen 1:1 aus dem vom Nutzer
//   bereitgestellten scripts/smg_parser.py übernommen (dort empirisch
//   ermittelt und gegen Quersummen geprüft) — hier NICHT neu hergeleitet.
//   Jede K04/K33-Zeile trägt ihre eigene tier_id im langen RFID-Format
//   ("CH113<8-stellige TVD-Nr.><Prüfziffer>"), die über die in
//   core/backend/fmis_core/agrident.py bestätigte Regel auf die kurze Form
//   umgerechnet wird, um die richtige Kuh/Aue per ear_tag zu finden — ein
//   separater Import der Y01-Stammdaten ist dafür nicht nötig.

import { read, utils, type WorkSheet } from 'xlsx'
import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'
import type { ParsedLactation, ParsedMilkTest } from './importAdis'
import type { AnimalSex, AnimalStatus } from '../types'

export interface TvdAnimal {
  ear_tag: string
  name: string | null
  breed_code: string | null
  birth_date: string | null
  sex: AnimalSex | null
  status: AnimalStatus
  entry_date: string | null
  exit_date: string | null
}

function excelDateToIso(value: unknown): string | null {
  if (value instanceof Date) {
    // SheetJS (cellDates) liefert Excel-Datumszellen als Date auf LOKALE
    // Mitternacht. toISOString() würde nach UTC umrechnen und in jeder
    // Zeitzone östlich von UTC (Zürich!) jedes Datum um einen Tag
    // zurücksetzen — deshalb die lokalen Komponenten verwenden.
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'string') {
    // Fallback, falls die Zelle als Text statt als Excel-Datum vorliegt
    // (Format TT.MM.JJJJ).
    const m = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (m) return `${m[3]}-${m[2]}-${m[1]}`
  }
  return null
}

/** Der TVD-Export schreibt einen falschen <dimension>-Tag (deklariert
 * "A1:C1" für ein 116x15-Blatt). SheetJS vertraut dem und liefert sonst
 * 0 Datenzeilen; pandas/openpyxl ignorieren ihn. Deshalb den echten
 * Bereich aus den tatsächlich vorhandenen Zellen neu bestimmen. */
function fixSheetRange(sheet: WorkSheet): void {
  let minR = Infinity
  let minC = Infinity
  let maxR = -1
  let maxC = -1
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue
    const { r, c } = utils.decode_cell(key)
    if (r < minR) minR = r
    if (r > maxR) maxR = r
    if (c < minC) minC = c
    if (c > maxC) maxC = c
  }
  if (maxR >= 0) {
    sheet['!ref'] = utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } })
  }
}

/** Liest den TVD-Tierbestand (eine Zeile pro aktuellem Tier). */
export async function parseTierbestand(file: File): Promise<TvdAnimal[]> {
  const buf = await file.arrayBuffer()
  const workbook = read(buf, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  fixSheetRange(sheet)
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

  return rows
    .map((row): TvdAnimal | null => {
      const ear_tag = String(row['Ohrmarkennummer'] ?? '').trim()
      if (!ear_tag) return null
      const geschlecht = String(row['Geschlecht'] ?? '').trim()
      const exit_date = excelDateToIso(row['Abgangsdatum'])
      return {
        ear_tag,
        name: row['Tiername'] ? String(row['Tiername']).trim() : null,
        breed_code: row['Rasse '] ? String(row['Rasse ']).trim() : null,
        birth_date: excelDateToIso(row['Geburtsdatum']),
        sex: geschlecht === 'Weiblich' ? 'w' : geschlecht === 'Männlich' ? 'm' : null,
        status: exit_date ? 'abgegangen' : 'aktiv',
        entry_date: excelDateToIso(row['Zugangsdatum']),
        exit_date,
      }
    })
    .filter((a): a is TvdAnimal => a !== null)
}

const SMG_ENCODING = 'windows-1252' // deckt Latin-1 ab, ohne UTF-8-Mehrbyte-Risiko bei fixed-width-Positionen

function smgSlice(line: string, start: number, end: number): string {
  return line.slice(start, end).trim()
}

function smgInt(line: string, start: number, end: number): number | null {
  const v = smgSlice(line, start, end)
  if (v === '') return null
  const n = Number.parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

function smgDec(line: string, start: number, end: number): number | null {
  const v = smgSlice(line, start, end)
  if (v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function smgDate(line: string, start: number, end: number): string | null {
  const v = smgSlice(line, start, end)
  if (v.length === 8 && /^\d{8}$/.test(v) && v !== '00000000') {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
  }
  return null
}

/** Wandelt die lange SMG-tier_id in die kurze TVD-Ohrmarke um (gleiche
 * Regel wie core/backend/fmis_core/agrident.py:sheep_short_tag — dort
 * serverseitig für den APR600-Leser, hier clientseitig für den Datenimport;
 * bewusst nicht importiert, da dies clientseitiger Code ohne Backend-Bezug
 * ist). Gibt bei Nichtübereinstimmung die lange Form unverändert zurück, statt
 * die Zeile zu verwerfen — besser eine auffällig falsche Ohrmarke als ein
 * stillschweigend verlorener Datensatz. */
function smgShortTag(longTag: string): string {
  const m = /^CH113(\d{8})\d$/.exec(longTag)
  return m ? `CH${m[1]}` : longTag
}

async function readSmgLines(file: File): Promise<string[]> {
  const buf = await file.arrayBuffer()
  const text = new TextDecoder(SMG_ENCODING).decode(buf)
  return text.split(/\r?\n/).filter((l) => l.trim() !== '')
}

function parseK04Line(line: string): ParsedLactation | null {
  const ear_tag = smgShortTag(smgSlice(line, 22, 36))
  const lactation_number = smgInt(line, 68, 70)
  const calving_date = smgDate(line, 70, 78)
  if (!ear_tag || lactation_number == null || !calving_date) return null
  const closure_type = smgInt(line, 83, 84)
  const milk_kg = smgInt(line, 88, 93)
  if (closure_type == null || milk_kg == null) return null
  return {
    ear_tag,
    lactation_number,
    calving_date,
    closure_type: closure_type as ParsedLactation['closure_type'],
    days_in_milk: smgInt(line, 84, 88),
    milk_kg,
    fat_kg: smgInt(line, 93, 97),
    fat_pct: smgDec(line, 97, 101),
    protein_kg: smgInt(line, 101, 105),
    protein_pct: smgDec(line, 105, 109),
  }
}

function parseK33Line(line: string): ParsedMilkTest | null {
  const ear_tag = smgShortTag(smgSlice(line, 22, 36))
  const test_date = smgDate(line, 81, 89)
  const milk_kg = smgDec(line, 89, 93)
  const fat_pct = smgDec(line, 93, 97)
  const protein_pct = smgDec(line, 97, 101)
  if (!ear_tag || !test_date || milk_kg == null || fat_pct == null || protein_pct == null) {
    return null
  }
  return {
    ear_tag,
    test_date,
    calving_date: smgDate(line, 68, 76),
    lactation_number: smgInt(line, 76, 79),
    milk_kg,
    fat_pct,
    protein_pct,
    lactose_pct: smgDec(line, 101, 105),
    cell_count: smgInt(line, 108, 112),
    urea_mg_dl: smgInt(line, 112, 115),
  }
}

export interface SmgParseResult {
  lactations: ParsedLactation[]
  milkTests: ParsedMilkTest[]
  warnings: string[]
}

/** Liest b<Betrieb>.K04 (Laktationen) und b<Betrieb>.K33 (Milchkontrollen)
 * — welche Datei welche ist, wird pro Zeile an den ersten 3 Zeichen erkannt
 * (Satzart), nicht am Dateinamen, gleiches Muster wie parseAdisFiles. */
export async function parseSmgFiles(files: File[]): Promise<SmgParseResult> {
  const lactations: ParsedLactation[] = []
  const milkTests: ParsedMilkTest[] = []
  const warnings: string[] = []

  for (const file of files) {
    const lines = await readSmgLines(file)
    for (const line of lines) {
      const satzart = line.slice(0, 3)
      if (satzart === 'K04') {
        const parsed = parseK04Line(line)
        if (parsed) lactations.push(parsed)
        // Keine Warnung bei null: die häufige Tier-Kopfzeile ohne
        // Laktationsdaten wäre sonst pro Tier eine Warnung ohne Mehrwert
        // (gleiches Verhalten wie parseAdisFiles bei K04).
      } else if (satzart === 'K33') {
        const parsed = parseK33Line(line)
        if (parsed) milkTests.push(parsed)
        else warnings.push(`${file.name}: K33-Zeile mit fehlenden Pflichtwerten übersprungen`)
      }
      // Andere Satzarten (K09/K44/K45/Y01/Y02) werden ignoriert — kein
      // FMIS-Schema-Feld dafür, siehe Planungs-Kontext.
    }
  }

  return { lactations, milkTests, warnings }
}

export interface SmgImportSummary {
  animalsImported: number
  lactationsImported: number
  milkTestsImported: number
  unmatchedEarTags: string[]
}

/** Importiert den TVD-Tierbestand (alle Tiere) plus die SMG-Anreicherung
 * (Laktationen/Milchkontrollen für die Teilmenge mit Milchleistungsdaten).
 * Re-Import ist idempotent — überschreibt bestehende Zeilen statt sie zu
 * duplizieren (gleiche find-or-create/Dedupe-Logik wie importAdisData). */
export async function importSmgData(
  pg: PGlite,
  tierbestand: TvdAnimal[],
  smg: SmgParseResult,
): Promise<SmgImportSummary> {
  const { rows: existingAnimals } = await pg.query<{ id: string; ear_tag: string; notes: string | null; lauf_nr: string | null }>(
    'select id, ear_tag, notes, lauf_nr from animals',
  )
  const earTagToId = new Map(existingAnimals.map((a) => [a.ear_tag, a.id]))
  // In der App gepflegte Felder (Bemerkung, Laufnummer) beim Re-Import nicht
  // überschreiben, wenn der Export nichts dazu liefert.
  const existingByTag = new Map(existingAnimals.map((a) => [a.ear_tag, a]))

  for (const animal of tierbestand) {
    const id = earTagToId.get(animal.ear_tag) ?? crypto.randomUUID()
    earTagToId.set(animal.ear_tag, id)
    const prev = existingByTag.get(animal.ear_tag)
    await upsertRow(pg, 'animals', { id, ...animal, lauf_nr: prev?.lauf_nr ?? null, notes: prev?.notes ?? null })
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

  const unmatchedEarTags = new Set<string>()
  let lactationsImported = 0
  for (const lactation of smg.lactations) {
    const animalId = earTagToId.get(lactation.ear_tag)
    if (!animalId) {
      unmatchedEarTags.add(lactation.ear_tag)
      continue
    }
    const key = `${animalId}|${lactation.lactation_number}|${lactation.closure_type}`
    const id = lactationKeyToId.get(key) ?? crypto.randomUUID()
    lactationKeyToId.set(key, id)
    const { ear_tag: _earTag, ...rest } = lactation
    await upsertRow(pg, 'lactations', { id, animal_id: animalId, ...rest })
    lactationsImported++
  }

  const { rows: existingTests } = await pg.query<{ id: string; animal_id: string; test_date: string }>(
    'select id, animal_id, test_date from milk_tests',
  )
  const testKeyToId = new Map(existingTests.map((t) => [`${t.animal_id}|${t.test_date}`, t.id]))

  let milkTestsImported = 0
  for (const test of smg.milkTests) {
    const animalId = earTagToId.get(test.ear_tag)
    if (!animalId) {
      unmatchedEarTags.add(test.ear_tag)
      continue
    }
    const key = `${animalId}|${test.test_date}`
    const id = testKeyToId.get(key) ?? crypto.randomUUID()
    testKeyToId.set(key, id)
    const { ear_tag: _earTag, ...rest } = test
    await upsertRow(pg, 'milk_tests', { id, animal_id: animalId, ...rest })
    milkTestsImported++
  }

  return {
    animalsImported: tierbestand.length,
    lactationsImported,
    milkTestsImported,
    unmatchedEarTags: [...unmatchedEarTags],
  }
}
