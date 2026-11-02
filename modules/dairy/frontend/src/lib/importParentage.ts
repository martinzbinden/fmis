// Abstammung aus Tierlisten: SMG-«Tierliste» (Excel aus dem Herdebuch-Portal,
// Blatt dtAnimalList1, Spalten «Orig.-Nr.», «Vater», «Mutter») und — als
// Ersatz, falls ein Tier im Zuchtbuch fehlt — Mutter/Vater-Spalten einer
// TVD-Liste. Füllt nur Lücken im Stammbaum (pedigree): was das Herdebuch
// (lib/importAdis.ts) oder eine Erfassung schon weiss, bleibt. Die Eltern
// selbst bekommen einen Stammbaum-Eintrag (Name, Geschlecht), damit sie mit
// Namen erscheinen.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { writeImportRow } from './importMerge'

export interface ParentRef {
  key: string
  ear_tag: string
  name: string | null
}

export interface ParentageRow {
  key: string
  ear_tag: string
  name: string | null
  birth_date: string | null
  sex: 'w' | 'm' | null
  sire: ParentRef | null
  dam: ParentRef | null
}

/** "1777.9901 EUGEN" → Ohrmarke + Name; "1971.1090 " → nur Ohrmarke. */
export function parseParentCell(v: unknown): ParentRef | null {
  const text = String(v ?? '').trim()
  if (!text) return null
  const m = /^([A-Z]{2}\s?)?([\d.\s]{8,})\s*(.*)$/i.exec(text)
  if (!m) return null
  const tag = `${m[1] ?? ''}${m[2]}`.trim()
  const key = animalKey(tag)
  if (!key || !/\d{8}/.test(key)) return null
  return { key, ear_tag: tag.replace(/\s+/g, ''), name: m[3].trim() || null }
}

const isoFromSwiss = (v: unknown): string | null => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(v ?? '').trim())
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

/** Ist das eine SMG-Tierliste? (Spalten Orig.-Nr., Vater, Mutter) */
export function isSmgAnimalList(headers: string[]): boolean {
  const h = new Set(headers.map((x) => x.trim()))
  return h.has('Orig.-Nr.') && h.has('Vater') && h.has('Mutter')
}

/** Zeilen einer SMG-Tierliste (sheet_to_json mit Kopfzeile). */
export function parseSmgAnimalList(rows: Record<string, unknown>[]): ParentageRow[] {
  const out: ParentageRow[] = []
  for (const r of rows) {
    const tag = String(r['Orig.-Nr.'] ?? '').trim()
    const key = animalKey(tag)
    if (!key) continue
    const sex = String(r['Ges.'] ?? '').trim().toUpperCase()
    out.push({
      key,
      ear_tag: key,
      name: String(r['Name'] ?? '').trim() || null,
      birth_date: isoFromSwiss(r['Geb.-Dat']),
      sex: sex === 'F' || sex === 'W' ? 'w' : sex === 'M' ? 'm' : null,
      sire: parseParentCell(r['Vater']),
      dam: parseParentCell(r['Mutter']),
    })
  }
  return out
}

/** Mutter/Vater-Spalten einer TVD-Liste, falls vorhanden (Spaltennamen mit
 * «Mutter» bzw. «Vater»). Die üblichen TVD-Tierbestände haben keine. */
export function tvdParentColumns(headers: string[]): { dam: string | null; sire: string | null } {
  const find = (word: RegExp) => headers.find((h) => word.test(h) && !/name/i.test(h)) ?? null
  return { dam: find(/mutter/i), sire: find(/vater/i) }
}

/** Stammbaum ergänzen. Gibt die Zahl neu angelegter oder ergänzter Einträge zurück. */
export async function importParentage(pg: PGlite, rows: ParentageRow[]): Promise<{ filled: number; withParents: number }> {
  const { rows: existing } = await pg.query<Record<string, unknown> & { id: string; animal_key: string }>('select * from pedigree')
  const byKey = new Map(existing.map((p) => [p.animal_key, p]))
  let filled = 0
  const ensure = async (ref: ParentRef, sex: 'w' | 'm') => {
    if (byKey.has(ref.key)) return
    const row = { id: crypto.randomUUID(), animal_key: ref.key, ear_tag: ref.key, sire_key: null, dam_key: null, breed_code: null, name: ref.name, birth_date: null, sex, source: 'import' }
    await writeImportRow(pg, 'pedigree', row as never, undefined)
    byKey.set(ref.key, row as never)
  }
  for (const r of rows) {
    if (r.sire) await ensure(r.sire, 'm')
    if (r.dam) await ensure(r.dam, 'w')
    const prev = byKey.get(r.key)
    if (prev?.deleted_at) continue
    // nur Lücken füllen: Herdebuch und Erfassungen haben Vorrang
    const row: Record<string, unknown> & { id: string } = prev
      ? { ...prev, id: String(prev.id) }
      : { id: crypto.randomUUID(), animal_key: r.key, ear_tag: r.ear_tag, sire_key: null, dam_key: null, breed_code: null, name: null, birth_date: null, sex: null, source: 'import' }
    const fill: [string, unknown][] = [
      ['dam_key', r.dam?.key ?? null],
      ['sire_key', r.sire?.key ?? null],
      ['name', r.name],
      ['birth_date', r.birth_date],
      ['sex', r.sex],
    ]
    for (const [k, v] of fill) if (row[k] == null && v != null) row[k] = v
    if (await writeImportRow(pg, 'pedigree', row as never, prev)) {
      filled++
      byKey.set(r.key, row as never)
    }
  }
  return { filled, withParents: rows.filter((r) => r.dam || r.sire).length }
}
