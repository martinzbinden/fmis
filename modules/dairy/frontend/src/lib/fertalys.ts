// FERTALYS-Resultate (Trächtigkeitstest aus der Milchprobe) aus der Mail von swissherdbook/Holstein (cownect, Qualitas):
// je Zeile «NAME Trächtig» bzw. «NAME Nicht trächtig», ohne Ohrmarke und ohne Probedatum. Zuordnung über den Tiernamen
// (aktive weibliche Tiere), Datum = letzte Milchprobe der Kuh bis zum Mail-Datum (daraus stammt der Test), sonst Mail-Datum.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { inTransaction } from '../db/transaction'
import { upsertRow } from '../db/write'
import { isoDate } from './format'
import type { PregnancyResult } from '../types'

export interface FertalysLine {
  name: string
  result: PregnancyResult
  /** Wortlaut aus der Mail */
  text: string
}

const RESULT_WORDS: [RegExp, PregnancyResult][] = [
  [/^nicht\s+tr[äa]chtig$/i, 'nein'],
  [/^tr[äa]chtig$/i, 'ja'],
  [/^(fraglich|zweifelhaft|unsicher|unklar|wiederholen|nachkontrolle)\b.*$/i, 'unsicher'],
]
const LINE = /^\s*(.+?)\s+(nicht\s+tr[äa]chtig|tr[äa]chtig|fraglich|zweifelhaft|unsicher|unklar|wiederholen.*|nachkontrolle.*)\s*$/i
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mär: 3, mae: 3, mar: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 }

/** Zeilen mit Name + Resultat; Anrede, Grüsse und Kopfzeilen fallen weg. */
export function parseFertalys(text: string): FertalysLine[] {
  const out: FertalysLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw)
    if (!m) continue
    const name = m[1].replace(/[:\-–·|]+$/, '').trim()
    // Fliesstext («Sie erhalten Ihre neuen FERTALYS Resultate») ist keine Resultatzeile
    if (!name || name.split(/\s+/).length > 3 || /[.,!?]/.test(name)) continue
    const word = m[2].trim()
    const result = RESULT_WORDS.find(([re]) => re.test(word))?.[1]
    if (result) out.push({ name, result, text: word })
  }
  return out
}

/** Datum der Mail aus dem eingefügten Text: «26.08.2026», «26. Aug. 2026» oder «Mi., 26. Aug., 16:20» (Jahr fehlt → das
 * letzte solche Datum bis heute). */
export function parseMailDate(text: string, today: string): string | null {
  const iso = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const num = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(text)
  if (num) return iso(Number(num[3]), Number(num[2]), Number(num[1]))
  const word = /\b(\d{1,2})\.\s*([A-Za-zÄäÖöÜü]{3})[a-zäöü]*\.?,?\s*(\d{4})?/.exec(text)
  if (!word) return null
  const mo = MONTHS[word[2].toLowerCase()]
  if (!mo) return null
  const d = Number(word[1])
  if (word[3]) return iso(Number(word[3]), mo, d)
  const y = Number(today.slice(0, 4))
  const guess = iso(y, mo, d)
  return guess <= today ? guess : iso(y - 1, mo, d)
}

const norm = (s: string) => s.toLocaleUpperCase('de-CH').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export interface FertalysPlan {
  line: FertalysLine
  /** gefundenes Tier; null = kein oder mehrere Tiere mit dem Namen */
  animal: { id: string; label: string } | null
  problem: string | null
  /** Datum der Probe: letzte Milchprobe bis zum Mail-Datum */
  date: string
  dateBasis: 'milchprobe' | 'mail'
  /** schon gespeichert (gleiches Tier, Datum, FERTALYS) */
  existingId: string | null
}

/** Zeilen den Tieren zuordnen und das Probedatum bestimmen (liest nur). */
export async function planFertalys(pg: PGlite, lines: FertalysLine[], mailDate: string): Promise<FertalysPlan[]> {
  const [animals, tests, checks] = await Promise.all([
    pg.query<{ id: string; name: string | null; ear_tag: string; lauf_nr: string | null }>("select id, name, ear_tag, lauf_nr from animals where deleted_at is null and status = 'aktiv' and coalesce(sex, 'w') = 'w'").then((r) => r.rows),
    pg.query<{ animal_id: string; test_date: unknown }>('select animal_id, test_date from milk_tests where deleted_at is null and test_date <= $1', [mailDate]).then((r) => r.rows),
    pg.query<{ id: string; animal_id: string; check_date: unknown }>("select id, animal_id, check_date from pregnancy_checks where deleted_at is null and method = 'fertalys'").then((r) => r.rows),
  ])
  const byName = new Map<string, typeof animals>()
  for (const a of animals) if (a.name) byName.set(norm(a.name), [...(byName.get(norm(a.name)) ?? []), a])
  const lastTest = new Map<string, string>()
  for (const t of tests) {
    const d = isoDate(t.test_date)
    if (d && (lastTest.get(t.animal_id) ?? '') < d) lastTest.set(t.animal_id, d)
  }
  return lines.map((line) => {
    const hits = byName.get(norm(line.name)) ?? []
    const a = hits.length === 1 ? hits[0] : null
    const sample = a ? lastTest.get(a.id) : undefined
    // Milchprobe höchstens 6 Wochen vor der Mail, sonst passt sie nicht zum Test
    const useSample = sample && Date.parse(mailDate) - Date.parse(sample) <= 42 * 86_400_000
    const date = useSample ? sample : mailDate
    return {
      line,
      animal: a ? { id: a.id, label: `${a.lauf_nr ? `${a.lauf_nr} · ` : ''}${a.name}` } : null,
      problem: hits.length === 0 ? 'kein aktives Tier mit diesem Namen' : hits.length > 1 ? `${hits.length} Tiere mit diesem Namen` : null,
      date,
      dateBasis: useSample ? 'milchprobe' : 'mail',
      existingId: a ? (checks.find((c) => c.animal_id === a.id && isoDate(c.check_date) === date)?.id ?? null) : null,
    }
  })
}

/** Zugeordnete Zeilen speichern (Einzelbefunde ohne Durchgang); schon vorhandene werden korrigiert, nicht verdoppelt. */
export async function applyFertalys(pg: PGlite, plan: FertalysPlan[], mailDate: string): Promise<number> {
  const rows = plan.filter((p) => p.animal)
  await inTransaction(pg, async (tx) => {
    for (const p of rows)
      await upsertRow(tx, 'pregnancy_checks', {
        id: p.existingId ?? crypto.randomUUID(),
        animal_id: p.animal!.id,
        check_date: p.date,
        result: p.line.result,
        weeks: null,
        source: 'manual',
        round_id: null,
        examiner: 'FERTALYS',
        method: 'fertalys',
        duration_unit: 'wochen',
        notes: `FERTALYS-Mail ${mailDate.split('-').reverse().join('.')}: ${p.line.text}`,
        recorded_at: new Date().toISOString(),
        created_by: getCurrentUserEmail(),
        deleted_at: null,
      })
  })
  return rows.length
}
