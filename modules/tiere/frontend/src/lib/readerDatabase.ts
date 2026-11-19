// Tierinfos als Datenbank aufs Lesegerät (components/ReaderListsDialog.tsx → POST /tiere/reader/database,
// modules/tiere/backend/app/reader_database.py). Das Gerät zeigt Feld 1 (VID) nach dem Lesen; die übrigen Felder stehen
// unter Menü → Daten → Suche per EID (Datenbank-Taste). Jedes Feld höchstens 20 Zeichen, nur ASCII ohne Kommas.

import { earTagToReaderIso } from '@fmis/core/tagReader'
import { shortEarTag } from '@fmis/core/earTag'
import { deviceText, vidText, type ReaderEntry } from './readerLists'

export interface DbField {
  title: string
  width: number
  flag: number
  /** 9 = VID (erscheint nach dem Lesen), 3 = Text */
  type: number
}

export interface DbRow {
  iso: string
  values: string[]
}

const WIDTH = 20
const field = (title: string, type = 3): DbField => ({ title, width: WIDTH, flag: 0, type })

/** Felder in der Reihenfolge der Werte; Titel ohne Umlaute (Anzeige am Gerät). */
export const DB_FIELDS: DbField[] = [
  field('VID', 9),
  field('Gruppe'),
  field('Laktation'),
  field('Laemmer'),
  field('Ablammung'),
  field('Belegung'),
  field('Traechtigkeit'),
  field('Milch'),
  field('Ohrmarke'),
]

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000)
const days = (from: string, today: string) => dayNumber(today) - dayNumber(from)
const ddmmyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`
const clip = (s: string) => deviceText(s).slice(0, WIDTH).trimEnd()
const RESULT: Record<string, string> = { ja: 'ja', nein: 'leer', unsicher: '?' }

/** Die Texte eines Tiers, ein Wert je Feld von DB_FIELDS. */
export function dbValues(e: ReaderEntry, today: string): string[] {
  const f = e.facts
  const dated = (iso: string | null | undefined) => (iso ? clip(`${ddmmyy(iso)} (${days(iso, today)} T)`) : '')
  const milk = f?.idxPerformance != null ? clip(`${Math.round(f.idxPerformance)} Pt${f.performanceRel != null ? ` - ${Math.round(f.performanceRel * 100)}%` : ''}`) : ''
  return [
    vidText(e, 'gruppe', today),
    clip(e.group ?? ''),
    e.dry ? 'trocken' : f?.lastBirth ? `${days(f.lastBirth, today)} Tage` : '',
    f?.nursing ? `${f.nursing} saugend` : '',
    dated(f?.lastBirth),
    dated(f?.lastService),
    f?.pregnancy ? clip(`${RESULT[f.pregnancy.result]} ${ddmmyy(f.pregnancy.date)} (${days(f.pregnancy.date, today)} T)`) : f?.lastBirth ? 'keine US' : '',
    milk,
    clip(shortEarTag(e.earTag)),
  ]
}

export interface ReaderDatabase {
  fields: DbField[]
  rows: DbRow[]
  stats: { animals: number; noTag: number }
}

export function buildReaderDatabase(entries: ReaderEntry[], today: string): ReaderDatabase {
  const rows: DbRow[] = []
  let noTag = 0
  for (const e of entries) {
    const iso = earTagToReaderIso(e.earTag)
    if (!iso) {
      noTag++
      continue
    }
    rows.push({ iso, values: dbValues(e, today) })
  }
  return { fields: DB_FIELDS, rows, stats: { animals: rows.length, noTag } }
}

