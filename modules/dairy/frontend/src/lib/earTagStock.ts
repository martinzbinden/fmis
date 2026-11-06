// Ohrmarken-Vorrat: TVD-«Lagerbestand» (Excel, Spalten Ohrmarken-Nr., Ohrmarkentyp, Gattung), eine
// Datei für alle Gattungen. Jede Herde übernimmt ihre Zeilen. Vorgeschlagen wird die nächste freie
// Marke: zuerst die längste zusammenhängende Reihe, einzelne Reste aus alten Reihen zuletzt.

import type { PGlite } from '@electric-sql/pglite'
import { utils, type WorkBook } from 'xlsx'
import { animalKey } from '@fmis/core/earTag'
import { sqlDate, writeImportRow } from './importMerge'
import { compactEarTag } from './recordBirth'
import { isoDate } from './format'
import type { speciesOf } from './species'

type Species = ReturnType<typeof speciesOf>

export interface StockRow {
  ear_tag: string
  key: string
  tag_type: string | null
  species: Species | null
}

const SPECIES: Record<string, Species> = { schafe: 'sheep', rinder: 'cattle' }

export function isStockList(headers: string[]): boolean {
  const h = new Set(headers.map((x) => x.trim()))
  return h.has('Ohrmarken-Nr.') && h.has('Ohrmarkentyp') && h.has('Gattung')
}

/** Zeilen des ersten Blatts. Die TVD-Exporte deklarieren einen falschen Bereich (siehe importTvd.ts):
 * darum die Zellen direkt lesen statt sheet_to_json. */
export function readStockList(wb: WorkBook): StockRow[] | null {
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const table = new Map<number, Map<number, string>>()
  for (const k of Object.keys(sheet)) {
    if (k.startsWith('!')) continue
    const { r, c } = utils.decode_cell(k)
    if (!table.has(r)) table.set(r, new Map())
    table.get(r)!.set(c, String(sheet[k].v ?? '').trim())
  }
  const head = table.get(0)
  if (!head || !isStockList([...head.values()])) return null
  const col = (name: string) => [...head].find(([, v]) => v === name)![0]
  const [tag, type, kind] = [col('Ohrmarken-Nr.'), col('Ohrmarkentyp'), col('Gattung')]
  const out: StockRow[] = []
  for (const [r, cells] of table) {
    const key = r > 0 ? animalKey(cells.get(tag)) : null
    if (!key) continue
    out.push({
      ear_tag: compactEarTag(cells.get(tag)!),
      key,
      tag_type: cells.get(type) || null,
      species: SPECIES[(cells.get(kind) ?? '').toLowerCase()] ?? null,
    })
  }
  return out
}

/** Stand aus dem Dateinamen des Exports («2026-11-06_Ohrmarken_Lagerbestand…»), sonst heute. */
export function stockDateOf(fileName: string, today: string): string {
  return /^(\d{4}-\d{2}-\d{2})_/.exec(fileName)?.[1] ?? today
}

/** Ergänzt und setzt den Stand; löscht nie. Eine ältere Liste ändert nichts an neueren Einträgen. */
export async function importEarTagStock(pg: PGlite, rows: StockRow[], stockDate: string): Promise<number> {
  const { rows: existing } = await pg.query<Record<string, unknown>>('select * from ear_tag_stock')
  const byKey = new Map(existing.map((r) => [String(r.animal_key), r]))
  let written = 0
  for (const r of rows) {
    const prev = byKey.get(r.key)
    if (prev?.deleted_at || (prev && sqlDate(prev.stock_date) >= stockDate)) continue
    const row = { id: prev ? String(prev.id) : crypto.randomUUID(), ear_tag: r.ear_tag, animal_key: r.key, tag_type: r.tag_type, stock_date: stockDate }
    if (await writeImportRow(pg, 'ear_tag_stock', row, prev)) written++
  }
  return written
}

/** Laufnummer einer Marke: ohne Prüfziffer bei Rindern, damit Nachbarn als Reihe erkannt werden. */
function serial(key: string): number | null {
  const m = /^CH120(\d{8})\d$/.exec(key) ?? /^CH(\d{8})$/.exec(key)
  return m ? Number(m[1]) : null
}

/** Freie Marken in der Reihenfolge des Vorschlags. */
export function orderFreeTags<T extends { animal_key: string }>(stock: T[], used: Set<string>): T[] {
  const free = stock.filter((s) => !used.has(s.animal_key))
  const known = free.filter((s) => serial(s.animal_key) != null).sort((a, b) => serial(a.animal_key)! - serial(b.animal_key)!)
  const runs: T[][] = []
  for (const s of known) {
    const last = runs.at(-1)
    if (last && serial(s.animal_key) === serial(last.at(-1)!.animal_key)! + 1) last.push(s)
    else runs.push([s])
  }
  // sort ist stabil: gleich lange Reihen bleiben aufsteigend
  runs.sort((a, b) => b.length - a.length)
  return [...runs.flat(), ...free.filter((s) => serial(s.animal_key) == null)]
}

export interface TagStock {
  /** Ohrmarken in der Reihenfolge des Vorschlags */
  free: string[]
  /** neuester Stand; null = noch keine Liste eingelesen */
  date: string | null
}

export async function loadTagStock(pg: PGlite): Promise<TagStock> {
  const [stock, animals, offspring, pedigree] = await Promise.all([
    pg.query<{ ear_tag: string; animal_key: string; stock_date: unknown }>('select ear_tag, animal_key, stock_date from ear_tag_stock where deleted_at is null'),
    pg.query<{ ear_tag: string }>('select ear_tag from animals where deleted_at is null'),
    pg.query<{ ear_tag: string }>('select ear_tag from birth_offspring where deleted_at is null and ear_tag is not null'),
    pg.query<{ animal_key: string }>('select animal_key from pedigree where deleted_at is null'),
  ])
  const dates = stock.rows.map((s) => isoDate(s.stock_date)!)
  const date = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
  const used = new Set<string>(pedigree.rows.map((p) => p.animal_key))
  for (const r of [...animals.rows, ...offspring.rows]) {
    const key = animalKey(r.ear_tag)
    if (key) used.add(key)
  }
  return { free: orderFreeTags(stock.rows.filter((s) => isoDate(s.stock_date) === date), used).map((s) => s.ear_tag), date }
}
