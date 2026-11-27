// Begleitdokument für Klauentiere auf Papier (BLV-Formular, Auflage 2023) samt «Tierliste – Beilage» (Auflage 2020),
// z.B. wenn die TVD nicht erreichbar ist. Die leeren, ausfüllbaren Formulare liegen auf der Instanz (Modul Tiere →
// Merkblätter, Thema «Vorlage …»), nicht im Repo; FMIS füllt die Felder aus und hängt Original und Kopien aneinander.
// Feldnamen aus den PDF-Formularen (AcroForm) abgelesen.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'
import { isoDate } from './format'
import { notSupersededSql } from './journal'
import { latestPregnancy, monthsBetween } from './pregnancy'
import { withdrawalUntil } from './treatments'
import type { AnimalJournalEntry, PregnancyCheck } from '../types'

export type Purpose = 'verkauf' | 'schlachtung' | 'soemmerung' | 'markt' | 'ausstellung'
export const PURPOSES: { key: Purpose; label: string }[] = [
  { key: 'verkauf', label: 'Verkauf' },
  { key: 'schlachtung', label: 'Schlachtung' },
  { key: 'soemmerung', label: 'Sömmerung / Winterung' },
  { key: 'markt', label: 'Markt, Auktion' },
  { key: 'ausstellung', label: 'Ausstellung' },
]

export interface BdAnimal {
  id: string
  ear_tag: string
  lauf_nr: string | null
  name: string | null
  birth_date: string | null
  sex: 'w' | 'm' | null
  /** Rindvieh: kastriert (Ochse) */
  castrated?: boolean
  /** Rindvieh: Trächtigkeit ja/nein; null = nicht anzugeben oder unbekannt */
  pregnant: 'ja' | 'nein' | null
  /** Rindvieh: Angabe zur Trächtigkeit nötig (Rinder ab 15 Monaten, Kühe ab 5 Monaten nach der letzten Geburt) */
  pregnancyNeeded: boolean
  /** Krankheit/Behandlung in den letzten 10 Tagen (Diagnosen) */
  sick: string[]
  /** offene Absetzfrist Fleisch */
  withdrawal: { until: string; medication: string; date: string } | null
}

export interface BdHolder {
  tvd: string
  name: string
  address: string
  place: string
}

export interface BdData {
  species: 'cattle' | 'sheep'
  date: string
  holder: BdHolder
  destination: string
  purpose: Purpose | null
  diseaseFree: boolean
  animals: BdAnimal[]
  /** Ort für «Ort / Datum der Standortänderung» */
  place: string
  signer: string
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Tiere mit allem, was das Formular braucht. */
export async function loadBdAnimals(pg: PGlite, ids: string[], species: 'cattle' | 'sheep', date: string): Promise<BdAnimal[]> {
  if (ids.length === 0) return []
  const [animals, journal, births, checks] = await Promise.all([
    pg.query<{ id: string; ear_tag: string; lauf_nr: string | null; name: string | null; birth_date: unknown; sex: 'w' | 'm' | null }>(
      'select id, ear_tag, lauf_nr, name, birth_date, sex from animals where id = any($1::uuid[]) and deleted_at is null',
      [ids],
    ),
    pg.query<AnimalJournalEntry>(
      `select j.* from animal_journal j where j.animal_id = any($1::uuid[]) and j.deleted_at is null and ${notSupersededSql('j')}
         and j.category in ('krankheit', 'behandlung')`,
      [ids],
    ),
    pg.query<{ dam_id: string; birth_date: unknown }>('select dam_id, birth_date from births where dam_id = any($1::uuid[]) and deleted_at is null', [ids]),
    species === 'cattle' ? pg.query<PregnancyCheck>('select * from pregnancy_checks where animal_id = any($1::uuid[]) and deleted_at is null', [ids]) : Promise.resolve({ rows: [] as PregnancyCheck[] }),
  ])
  const since = addDays(date, -10)
  const byId = new Map(animals.rows.map((a) => [a.id, a]))
  return ids
    .map((id) => byId.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => {
      const entries = journal.rows.filter((j) => j.animal_id === a.id).map((j) => ({ ...j, entry_date: isoDate(j.entry_date)!, last_date: isoDate(j.last_date), release_meat_date: isoDate(j.release_meat_date), release_milk_date: isoDate(j.release_milk_date) }))
      const sick = [...new Set(entries.filter((j) => j.entry_date >= since && j.entry_date <= date).map((j) => j.diagnosis || (j.category === 'krankheit' ? 'krank' : '')).filter(Boolean))]
      const open = entries
        .map((j) => ({ j, until: withdrawalUntil(j, 'meat') }))
        .filter((x): x is { j: (typeof entries)[number]; until: string } => !!x.until && x.until >= date && x.j.entry_date <= date)
        .sort((x, y) => y.until.localeCompare(x.until))[0]
      const birth = isoDate(a.birth_date)
      const lastBirth = births.rows.filter((b) => b.dam_id === a.id).map((b) => isoDate(b.birth_date)!).sort().at(-1) ?? null
      const pregnancyNeeded = species === 'cattle' && a.sex === 'w' && (lastBirth ? monthsBetween(lastBirth, date) >= 5 : !!birth && monthsBetween(birth, date) >= 15)
      const status = pregnancyNeeded
        ? latestPregnancy(
            checks.rows.filter((c) => c.animal_id === a.id).map((c) => ({ ...c, check_date: isoDate(c.check_date)! })),
            lastBirth,
          )
        : null
      return {
        id: a.id,
        ear_tag: a.ear_tag,
        lauf_nr: a.lauf_nr,
        name: a.name,
        birth_date: birth,
        sex: a.sex,
        pregnant: status?.result === 'ja' ? 'ja' : status?.result === 'nein' ? 'nein' : null,
        pregnancyNeeded,
        sick,
        withdrawal: open ? { until: open.until, medication: open.j.medication ?? '', date: open.j.last_date ?? open.j.entry_date } : null,
      }
    })
}

/** Ohrmarke für ein Kästchenfeld: ohne Leerzeichen/Punkte; zu lang → ohne Ländercode. */
export function formEarTag(earTag: string, maxLen: number | undefined): string {
  const compact = animalKey(earTag) ?? earTag.replace(/[\s.]/g, '').toUpperCase()
  if (!maxLen || compact.length <= maxLen) return compact
  return compact.replace(/^[A-Z]+/, '')
}

/** «2024-03-17» → Monat «03», Jahr «2024». */
export function monthYear(iso: string | null): { m: string; y: string } {
  return iso ? { m: iso.slice(5, 7), y: iso.slice(0, 4) } : { m: '', y: '' }
}

export const fmtDay = (iso: string) => iso.split('-').reverse().join('.')

/** Angaben zu Punkt 5: betroffene Tiere, Krankheiten, Medikamente, Datum. */
export function healthSummary(animals: BdAnimal[]) {
  const sick = animals.filter((a) => a.sick.length > 0)
  const medicated = animals.filter((a) => a.withdrawal)
  const affected = [...new Map([...sick, ...medicated].map((a) => [a.id, a])).values()]
  return {
    healthy: sick.length === 0,
    noWithdrawal: medicated.length === 0,
    affected,
    illness: [...new Set(sick.flatMap((a) => a.sick))].join(', '),
    medication: [...new Set(medicated.map((a) => a.withdrawal!.medication).filter(Boolean))].join(', '),
    treatDate: [...new Set(medicated.map((a) => fmtDay(a.withdrawal!.date)))].join(', '),
  }
}

/** Was vor dem Erstellen fehlt (Pflichtangaben). */
export function bdProblems(d: BdData): string[] {
  const out: string[] = []
  if (d.animals.length === 0) out.push('Keine Tiere gewählt.')
  if (!/^\d{7}$/.test(d.holder.tvd.trim())) out.push('TVD-Nr. des Betriebs (7 Ziffern) fehlt.')
  if (!d.holder.name.trim()) out.push('Name des Tierhalters fehlt.')
  if (!d.purpose) out.push('Bestimmungszweck wählen.')
  if (!d.destination.trim()) out.push('Bestimmungsort (Name und Adresse) fehlt.')
  const unknown = d.animals.filter((a) => a.pregnancyNeeded && !a.pregnant)
  if (unknown.length) out.push(`Trächtigkeit ja/nein angeben (${unknown.length} ${unknown.length === 1 ? 'Tier' : 'Tiere'}).`)
  return out
}

// --- PDF ------------------------------------------------------------------------------------------------------------

type PdfLib = typeof import('pdf-lib')
type Form = import('pdf-lib').PDFForm

function setText(form: Form, name: string, value: string, size = 9) {
  if (!value) return
  const f = form.getFields().find((x) => x.getName() === name || x.getName().replace(/\s+/g, ' ').trim() === name)
  if (!f || !('setText' in f)) return
  const tf = f as import('pdf-lib').PDFTextField
  const max = tf.getMaxLength()
  if (max != null && value.length > max) tf.setMaxLength(value.length)
  // Kästchenfelder (Ohrmarke, TVD-Nr.) behalten ihre Schrift, die übrigen haben teils keine Vorgabe (/DA)
  if (!tf.isCombed()) tf.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`)
  tf.setText(value)
}

function check(form: Form, name: string, on: boolean) {
  if (!on) return
  const f = form.getFields().find((x) => x.getName() === name)
  if (f && 'check' in f) (f as import('pdf-lib').PDFCheckBox).check()
}

function maxLenOf(form: Form, name: string): number | undefined {
  const f = form.getFields().find((x) => x.getName() === name)
  return f && 'getMaxLength' in f ? ((f as import('pdf-lib').PDFTextField).getMaxLength() ?? undefined) : undefined
}

/** Nach flatten(): Felder, die auf mehreren Seiten stehen (Original/Kopien), hinterlassen in den übrigen Seiten
 * Verweise auf gelöschte Widgets; die entfernen, sonst melden strenge Leser ein kaputtes PDF. */
function dropDanglingAnnots(lib: PdfLib, doc: import('pdf-lib').PDFDocument) {
  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i)
      if (ref instanceof lib.PDFRef && !doc.context.lookup(ref)) annots.remove(i)
    }
    if (annots.size() === 0) page.node.delete(lib.PDFName.of('Annots'))
  }
}

const SEX = (a: BdAnimal) => (a.sex === 'w' ? 'w' : a.sex === 'm' ? (a.castrated ? 'k' : 'm') : '')
const PURPOSE_BOX: Record<Purpose, string> = { verkauf: 'Check Box9', schlachtung: 'Check Box10', soemmerung: 'Check Box11', markt: 'Check Box12', ausstellung: 'Check Box13' }
const INLINE_ROWS = 3
const LIST_ROWS = 10

function fillHolder(form: Form, h: BdHolder) {
  setText(form, 'TVD-Nr', h.tvd.trim())
  setText(form, 'Name Vorname', h.name, 10)
  setText(form, 'Adresse', h.address, 10)
  setText(form, 'PLZ Wohnort', h.place, 10)
}

function fillRow(form: Form, d: BdData, a: BdAnimal, i: number, tagField: string) {
  setText(form, tagField, formEarTag(a.ear_tag, maxLenOf(form, tagField)))
  // Geburtsdatum, Geschlecht und Trächtigkeit verlangt das Formular nur beim Rindvieh
  if (d.species !== 'cattle') return
  const { m, y } = monthYear(a.birth_date)
  setText(form, `Monat ${i}`, m)
  setText(form, `Jahr ${i}`, y)
  setText(form, `m/w/k ${i}`, SEX(a))
  if (a.pregnancyNeeded && a.pregnant) setText(form, `Angabe ${i}`, a.pregnant)
}

/** Begleitdokument (Original, Kopie 1, Kopie 2) und bei mehr als 3 Tieren die Tierliste (je 10 Tiere Original + Kopie). */
export async function buildPdf(d: BdData, templates: { begleit: ArrayBuffer; tierliste: ArrayBuffer | null }): Promise<Uint8Array> {
  const lib: PdfLib = await import('pdf-lib')
  const { PDFDocument, StandardFonts } = lib
  const withList = d.animals.length > INLINE_ROWS
  if (withList && !templates.tierliste) throw new Error('Für mehr als 3 Tiere braucht es die Vorlage «Tierliste».')

  const bd = await PDFDocument.load(templates.begleit)
  const form = bd.getForm()
  fillHolder(form, d.holder)
  check(form, d.species === 'cattle' ? 'Checkbox 4' : 'Checkbox 6', true)
  setText(form, 'Total Tiere', String(d.animals.length), 11)
  check(form, 'Check Box 3', withList)
  if (!withList) d.animals.forEach((a, i) => fillRow(form, d, a, i + 1, `Tier-Nr. ${i + 1}`))
  setText(form, 'Name und Adresse desder KäufersKäuferin HändlersHändlerin sowie Zwischenhandel  Markt', d.destination, 10)
  if (d.purpose) check(form, PURPOSE_BOX[d.purpose], true)
  check(form, 'Check Box14', d.diseaseFree)
  const h = healthSummary(d.animals)
  check(form, 'Check Box15', h.healthy)
  check(form, 'Check Box16', h.noWithdrawal)
  if (h.affected.length) {
    const tags = h.affected.map((a) => formEarTag(a.ear_tag, undefined))
    const per = Math.ceil(tags.length / 3)
    ;['Der Tierhalterdie Tierhalterin meldet dass das Tierdie Tiere mit Identifikationsnummer', 'Tier mit Nr', 'Tier mit Nr 2'].forEach((name, k) =>
      setText(form, name, tags.slice(k * per, (k + 1) * per).join(', '), tags.length > 3 ? 7 : 9),
    )
    check(form, 'Check Box17', !h.healthy)
    setText(form, 'Art der Krankheit  Verletzung  des Unfalls', h.illness)
    check(form, 'Check Box18', !h.noWithdrawal)
    setText(form, 'Datum der Behandlung  Verfütterung', h.treatDate)
    setText(form, 'Medikamente', h.medication)
  }
  setText(form, 'Ort  Datum der Standortänderung', [d.place.trim(), fmtDay(d.date)].filter(Boolean).join(', '))
  setText(form, 'Name in Blockschrift', d.signer.trim().toUpperCase())
  const font = await bd.embedFont(StandardFonts.Helvetica)
  form.updateFieldAppearances(font)
  form.flatten()
  dropDanglingAnnots(lib, bd)

  const out = await PDFDocument.create()
  const [orig, copy1, copy2] = await out.copyPages(bd, [0, 1, 2])

  const listOriginals: import('pdf-lib').PDFPage[] = []
  const listCopies: import('pdf-lib').PDFPage[] = []
  if (withList) {
    for (let start = 0; start < d.animals.length; start += LIST_ROWS) {
      const tl = await PDFDocument.load(templates.tierliste!)
      const f = tl.getForm()
      fillHolder(f, d.holder)
      const chunk = d.animals.slice(start, start + LIST_ROWS)
      chunk.forEach((a, k) => {
        const i = k + 1
        fillRow(f, d, a, i, `Tier-Nr. ${i}`)
        setText(f, String(2 * i - 1), [a.lauf_nr, a.name].filter(Boolean).join(' · '))
      })
      const pages = Math.ceil(d.animals.length / LIST_ROWS)
      setText(f, String(2 * LIST_ROWS), pages > 1 ? `Blatt ${start / LIST_ROWS + 1} von ${pages}, total ${d.animals.length} Tiere` : '')
      setText(f, 'Anzahl Tiere', String(chunk.length), 11)
      setText(f, 'Tierliste_Erstellungsdatum', fmtDay(d.date), 11)
      f.updateFieldAppearances(await tl.embedFont(StandardFonts.Helvetica))
      f.flatten()
      dropDanglingAnnots(lib, tl)
      const [o, c] = await out.copyPages(tl, [0, 1])
      listOriginals.push(o)
      listCopies.push(c)
    }
  }
  // Original mit Tierliste begleitet die Tiere; Kopie 1 für Transport/Markt; Kopie 2 mit Tierliste bleibt auf dem Betrieb
  for (const p of [orig, ...listOriginals, copy1, copy2, ...listCopies]) out.addPage(p)
  return out.save({ useObjectStreams: false })
}

// --- Pendenz: Abgang in der TVD melden -------------------------------------------------------------------------------

export interface MovementDoc {
  id: string
  doc_date: string
  purpose: Purpose | null
  destination: string | null
  animals: { id: string; ear_tag: string }[]
  animal_count: number
  tvd_reported_on: string | null
}

export async function saveMovementDoc(pg: PGlite, d: BdData, createdBy: string | null): Promise<string> {
  const id = crypto.randomUUID()
  await upsertRow(pg, 'movement_docs', {
    id,
    doc_date: d.date,
    purpose: d.purpose,
    destination: d.destination.trim() || null,
    animals: JSON.stringify(d.animals.map((a) => ({ id: a.id, ear_tag: a.ear_tag }))),
    animal_count: d.animals.length,
    tvd_reported_on: null,
    notes: null,
    created_by: createdBy,
  })
  return id
}

export async function loadMovementDocs(pg: PGlite, sinceIso: string): Promise<MovementDoc[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    'select * from movement_docs where deleted_at is null and (tvd_reported_on is null or doc_date >= $1) order by doc_date desc, updated_at desc',
    [sinceIso],
  )
  return rows.map((r) => {
    let animals: MovementDoc['animals'] = []
    try {
      animals = JSON.parse(String(r.animals ?? '[]')) as MovementDoc['animals']
    } catch {
      /* alte oder kaputte Zeile */
    }
    return {
      id: String(r.id),
      doc_date: isoDate(r.doc_date)!,
      purpose: (r.purpose as Purpose | null) ?? null,
      destination: (r.destination as string | null) ?? null,
      animals,
      animal_count: Number(r.animal_count ?? animals.length),
      tvd_reported_on: isoDate(r.tvd_reported_on),
    }
  })
}

/** Anzahl gemeldeter Begleitdokumente vor sinceIso (die loadMovementDocs weglässt). */
export async function countOlderReported(pg: PGlite, sinceIso: string): Promise<number> {
  const { rows } = await pg.query<{ n: number }>('select count(*)::int as n from movement_docs where deleted_at is null and tvd_reported_on is not null and doc_date < $1', [sinceIso])
  return Number(rows[0]?.n ?? 0)
}

export async function setMovementReported(pg: PGlite, id: string, date: string | null): Promise<void> {
  const { rows } = await pg.query<Record<string, unknown>>('select * from movement_docs where id = $1', [id])
  if (!rows[0]) throw new Error('Begleitdokument nicht gefunden.')
  await upsertRow(pg, 'movement_docs', { ...rows[0], id, doc_date: isoDate(rows[0].doc_date), tvd_reported_on: date } as never)
}

/** Nummern zum Einfügen ins Agate-Portal: eine je Zeile. */
export const tagList = (doc: Pick<MovementDoc, 'animals'>) => doc.animals.map((a) => animalKey(a.ear_tag) ?? a.ear_tag).join('\n')
