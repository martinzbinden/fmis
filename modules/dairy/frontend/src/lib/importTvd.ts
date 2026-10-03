// TVD-Tierbestand (Excel aus der TVD) für die Milchschafe: der SMG-Herdebuch-
// export (lib/importAdis.ts) enthält nur Auen mit Milchleistungsdaten —
// Jungtiere und Widder kommen von hier. Die TVD liefert die Ohrmarke in der
// Kurzform ("CH20041511"); der Abgleich mit Tieren, die der Herdebuch-Import
// in der Langform "CH113…" angelegt hat, läuft über den normalisierten
// Schlüssel (core/frontend/src/earTag.ts).

import { read, utils, type WorkSheet } from 'xlsx'
import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { writeImportRow } from './importMerge'
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

/** Legt neue Tiere an bzw. ergänzt bestehende (lib/importMerge.ts: leere
 * Felder der TVD-Liste löschen nichts, z.B. Namen aus dem Herdebuch). Die
 * Langform einer bereits bekannten Ohrmarke bleibt erhalten. Gibt die Zahl
 * neu angelegter oder geänderter Tiere zurück. */
export async function importTierbestand(pg: PGlite, tierbestand: TvdAnimal[]): Promise<number> {
  const { rows: existing } = await pg.query<Record<string, unknown> & { id: string; ear_tag: string }>('select * from animals')
  const byKey = new Map(existing.map((a) => [animalKey(a.ear_tag) ?? a.ear_tag, a]))
  let written = 0
  for (const animal of tierbestand) {
    const key = animalKey(animal.ear_tag) ?? animal.ear_tag
    const prev = byKey.get(key)
    // Name und Rasse aus dem Herdebuch haben Vorrang (dort "BLÜMLISALP"/
    // "LAC", in der TVD "Blümlisalp"/"Lacaune") — sonst schrieben sich beide
    // Importe gegenseitig um. Die TVD füllt hier nur Lücken.
    const row = {
      id: prev?.id ?? crypto.randomUUID(),
      ...animal,
      ear_tag: prev?.ear_tag ?? animal.ear_tag,
      name: (prev?.name as string | null) || animal.name,
      breed_code: (prev?.breed_code as string | null) || animal.breed_code,
    }
    if (await writeImportRow(pg, 'animals', row, prev)) written++
    // doppelte Zeilen in derselben Liste nicht zweimal anlegen
    byKey.set(key, prev ?? row)
  }
  return written
}
