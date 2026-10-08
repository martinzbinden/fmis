// Strukturierte Daten einfügen (zentrale Import-Seite): aufbereitete
// Datensätze als JSON hineinkopieren, das Modul prüft sie gegen seine Daten
// (Pflichtfelder, Plausibilität, Doppelerfassungen), der Benutzer bestätigt,
// erst dann wird geschrieben. Nur ergänzen, nie löschen oder überschreiben.
//
// Format (ein Block oder eine Liste von Blöcken):
//   { "fmis_import": 1, "bereich": "dairy.behandlungen", "quelle": "…", "daten": [ {…}, … ] }
// "bereich" = Modul-Schlüssel + "." + Bereich; ohne Modul-Schlüssel nur, wenn
// eindeutig. Die Felder je Bereich beschreibt PasteImporter.fields — auf der
// Import-Seite als Text kopierbar, damit Daten ausserhalb (z.B. von einem
// Assistenten) passend aufbereitet werden können.

import type { PGlite } from '@electric-sql/pglite'

export interface PasteField {
  name: string
  required?: boolean
  /** z.B. "Datum JJJJ-MM-TT", "Zahl", "Text" */
  type: string
  description: string
}

export type CheckStatus = 'neu' | 'aehnlich' | 'doppelt' | 'fehler'

export interface CheckedRow {
  /** Position im eingefügten Block (0-basiert) */
  index: number
  status: CheckStatus
  /** Kurzzeile, z.B. "07.10.2026 · ANDRINA · Dolovet" */
  title: string
  detail?: string
  /** Fehler (status fehler), Grund für doppelt/ähnlich */
  problems: string[]
  /** Plausibilitäts-Hinweise; der Datensatz kann trotzdem übernommen werden */
  warnings: string[]
  /** Zur Kenntnis, kein Problem (z.B. "Tier nicht in der Herde") */
  info?: string[]
  /** normalisierter Datensatz für apply() */
  value: unknown
}

export interface PasteImporter {
  /** Bereich ohne Modul-Schlüssel, z.B. "behandlungen" */
  area: string
  label: string
  description: string
  /** Ohne dieses Recht wird der Bereich nicht angeboten */
  permission: string
  fields: PasteField[]
  example: Record<string, unknown>[]
  /** Prüft alle Datensätze gegen die Moduldaten (liest nur). */
  check(db: PGlite, rows: Record<string, unknown>[]): Promise<CheckedRow[]>
  /** Schreibt die bestätigten Datensätze; gibt die Anzahl zurück. */
  apply(db: PGlite, rows: CheckedRow[]): Promise<number>
}

export interface PasteBlock {
  bereich: string
  quelle: string | null
  daten: Record<string, unknown>[]
}

/** Eingefügten Text lesen: ein Block, eine Liste von Blöcken, oder (für
 * Bequemlichkeit) Markdown-Codeblock drumherum. */
export function parsePaste(text: string): PasteBlock[] {
  const raw = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  if (!raw) throw new Error('Nichts eingefügt.')
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (e) {
    const m = /position (\d+)/i.exec(e instanceof Error ? e.message : '')
    const at = m ? Number(m[1]) : null
    const line = at != null ? raw.slice(0, at).split('\n').length : null
    throw new Error(`Kein gültiges JSON${line ? ` (Zeile ${line})` : ''}: ${e instanceof Error ? e.message : String(e)}`)
  }
  const blocks = Array.isArray(value) && value.every((v) => v && typeof v === 'object' && 'bereich' in v) ? value : [value]
  return blocks.map((b, i) => {
    const o = b as Record<string, unknown>
    const label = blocks.length > 1 ? `Block ${i + 1}: ` : ''
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${label}Erwartet wird ein Objekt mit "bereich" und "daten".`)
    if (o.fmis_import !== undefined && o.fmis_import !== 1) throw new Error(`${label}Unbekannte Formatversion fmis_import=${String(o.fmis_import)}.`)
    if (typeof o.bereich !== 'string' || !o.bereich.trim()) throw new Error(`${label}"bereich" fehlt.`)
    if (!Array.isArray(o.daten)) throw new Error(`${label}"daten" muss eine Liste von Datensätzen sein.`)
    const bad = o.daten.findIndex((d) => !d || typeof d !== 'object' || Array.isArray(d))
    if (bad >= 0) throw new Error(`${label}Datensatz ${bad + 1} ist kein Objekt.`)
    return { bereich: o.bereich.trim(), quelle: typeof o.quelle === 'string' ? o.quelle : null, daten: o.daten as Record<string, unknown>[] }
  })
}

/** "dairy.behandlungen" bzw. "behandlungen" einem Modul-Bereich zuordnen. */
export function resolveArea<M extends { key: string; title: string; pasteImporters?: PasteImporter[] }>(
  bereich: string,
  modules: M[],
): { mod: M; importer: PasteImporter } {
  const [a, b] = bereich.includes('.') ? [bereich.slice(0, bereich.lastIndexOf('.')), bereich.slice(bereich.lastIndexOf('.') + 1)] : [null, bereich]
  const hits = modules.flatMap((mod) => (mod.pasteImporters ?? []).filter((p) => p.area === b && (a == null || mod.key === a)).map((importer) => ({ mod, importer })))
  if (hits.length === 1) return hits[0]
  const all = modules.flatMap((m) => (m.pasteImporters ?? []).map((p) => `${m.key}.${p.area}`))
  if (hits.length > 1) throw new Error(`"${bereich}" ist mehrdeutig — bitte mit Modul angeben: ${hits.map((h) => `${h.mod.key}.${b}`).join(', ')}.`)
  throw new Error(`Unbekannter Bereich "${bereich}". Möglich: ${all.join(', ') || 'keine (fehlende Rechte?)'}.`)
}

/** Formatbeschreibung als Text, zum Weitergeben an wer die Daten aufbereitet. */
export function formatSpec(moduleKey: string, moduleTitle: string, p: PasteImporter): string {
  const fields = p.fields.map((f) => `- ${f.name}${f.required ? ' (Pflicht)' : ''} — ${f.type}: ${f.description}`).join('\n')
  const example = JSON.stringify({ fmis_import: 1, bereich: `${moduleKey}.${p.area}`, quelle: 'Herkunft der Daten', daten: p.example }, null, 2)
  return `FMIS-Import «${p.label}» (${moduleTitle})
Bereich: ${moduleKey}.${p.area}
${p.description}

Felder je Datensatz:
${fields}

Beispiel:
${example}`
}

// --- Hilfen für die Prüfung in den Modulen ---

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Datum aus "2026-10-07" oder "7.10.2026"/"07.10.26"; null wenn leer, Fehlertext wenn ungültig. */
export function readDate(v: unknown): { value: string | null; error?: string } {
  if (v == null || v === '') return { value: null }
  const s = String(v).trim()
  const ch = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s)
  const iso = ch ? `${ch[3].length === 2 ? `20${ch[3]}` : ch[3]}-${ch[2].padStart(2, '0')}-${ch[1].padStart(2, '0')}` : s.slice(0, 10)
  if (!ISO.test(iso)) return { value: null, error: `"${s}" ist kein Datum (JJJJ-MM-TT)` }
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return { value: null, error: `"${s}" gibt es nicht` }
  return { value: iso }
}

/** Zahl aus 12 / "12" / "12,5"; null wenn leer, Fehlertext wenn keine Zahl. */
export function readNumber(v: unknown): { value: number | null; error?: string } {
  if (v == null || v === '') return { value: null }
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace(/['’\s]/g, ''))
  return Number.isFinite(n) ? { value: n } : { value: null, error: `"${String(v)}" ist keine Zahl` }
}

export const readText = (v: unknown): string | null => (v == null || String(v).trim() === '' ? null : String(v).trim())

export function readBool(v: unknown): boolean | null {
  if (v == null || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  return ['ja', 'true', '1', 'x', 'yes'].includes(s) ? true : ['nein', 'false', '0', 'no'].includes(s) ? false : null
}

/** Unbekannte Feldnamen (Tippfehler) als Hinweis. */
export function unknownFields(row: Record<string, unknown>, fields: PasteField[]): string[] {
  const known = new Set(fields.map((f) => f.name))
  return Object.keys(row).filter((k) => !known.has(k))
}
