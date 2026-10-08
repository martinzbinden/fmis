// «Strukturierte Daten einfügen» für das Behandlungsjournal (und andere
// Tierjournal-Einträge): prüft Tier, Datum, Präparat, Fristen und erkennt
// Doppelerfassungen — gegen frühere Einfügungen (import_key), gegen
// cownect-Importe und Handeinträge (gleiches Tier, Tag, Präparat) und
// innerhalb des Textes. Schreibt nur Neues (source 'import').

import type { PGlite } from '@electric-sql/pglite'
import { readBool, readDate, readNumber, readText, unknownFields, type CheckedRow, type PasteField, type PasteImporter } from '@fmis/core/pasteImport'
import { shortEarTag } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import { addDays, fmtDate, isoDate, localTodayIso } from './format'
import { JOURNAL_CATEGORIES, journalSummary } from './journal'
import { DEFAULT_WITHDRAWAL_FACTOR, normalizeEarTag, releaseDate, stableUuid } from './treatments'
import type { JournalCategory } from '../types'

export const TREATMENT_FIELDS: PasteField[] = [
  { name: 'ohrmarke', type: 'Text', description: 'TVD-Ohrmarke, z.B. "CH 120.1639.1520.0" oder "CH120163915200" — bevorzugt; Pflicht, wenn "tier" fehlt' },
  { name: 'tier', type: 'Text', description: 'Name oder Laufnummer, falls keine Ohrmarke (muss eindeutig sein)' },
  { name: 'tiername', type: 'Text', description: 'Name, für Tiere ausserhalb der Herde (Kälber, abgegangene)' },
  { name: 'datum', required: true, type: 'Datum JJJJ-MM-TT', description: 'erste Anwendung (bzw. Diagnose)' },
  { name: 'uhrzeit', type: 'HH:MM', description: 'Zeit der ersten Anwendung' },
  { name: 'letzte_anwendung', type: 'Datum JJJJ-MM-TT', description: 'letzte Anwendung, wenn über mehrere Tage' },
  { name: 'kategorie', type: 'Text', description: `behandlung (Standard), ${JOURNAL_CATEGORIES.filter((c) => c.key !== 'behandlung').map((c) => c.key).join(', ')}` },
  { name: 'indikation', type: 'Text', description: 'Befund / Diagnose, z.B. "Mastitis", "Enthornen"' },
  { name: 'organ', type: 'Text', description: 'Organsystem / Position, z.B. "Euter HL", "Klaue VR"' },
  { name: 'praeparat', type: 'Text', description: 'Handelsname des Tierarzneimittels (Pflicht bei Behandlung); je Präparat ein Datensatz' },
  { name: 'menge', type: 'Text', description: 'Menge mit Einheit, z.B. "10 ml", "1 Beutel (15 g)"' },
  { name: 'anwendungen', type: 'Zahl', description: 'Anzahl Anwendungen' },
  { name: 'frist_milch', type: 'Zahl (Tage)', description: 'Absetzfrist Milch laut Packungsbeilage, 0 = keine' },
  { name: 'frist_fleisch', type: 'Zahl (Tage)', description: 'Absetzfrist Fleisch/essbare Gewebe, 0 = keine' },
  { name: 'faktor', type: '1 oder 2', description: '2 = Fristen verdoppelt (Bio, Standard wenn leer), 1 = einfach' },
  { name: 'freigabe_milch', type: 'Datum JJJJ-MM-TT', description: 'erster Tag, an dem die Milch wieder geliefert werden darf (sonst gerechnet)' },
  { name: 'freigabe_fleisch', type: 'Datum JJJJ-MM-TT', description: 'erster Tag für Fleisch (sonst gerechnet)' },
  { name: 'behandelt_durch', type: 'Text', description: 'wer angewendet hat (Pflicht im Behandlungsjournal)' },
  { name: 'abgabestelle', type: 'Text', description: 'Tierarztpraxis / Herkunft des Arzneimittels' },
  { name: 'kritisches_antibiotikum', type: 'ja/nein', description: '' },
  { name: 'antibiogramm', type: 'ja/nein', description: '' },
  { name: 'fall', type: 'Text', description: 'gleicher Wert = gleicher Fall (mehrere Präparate); sonst Tier + Datum + Indikation' },
  { name: 'bemerkung', type: 'Text', description: '' },
]

const EXAMPLE = [
  {
    ohrmarke: 'CH 120.1234.5678.9',
    datum: '2026-04-19',
    letzte_anwendung: '2026-04-21',
    indikation: 'Mastitis akut',
    organ: 'Euter HL',
    praeparat: 'Beispiel-Injektor ad us. vet.',
    menge: '3 Injektoren',
    anwendungen: 3,
    frist_milch: 3,
    frist_fleisch: 3,
    faktor: 2,
    behandelt_durch: 'Vorname Name',
    abgabestelle: 'Tierarztpraxis',
  },
]

interface AnimalRow {
  id: string
  ear_tag: string
  name: string | null
  lauf_nr: string | null
}
interface ExistingRow {
  id: string
  animal_id: string | null
  ear_tag: string | null
  entry_date: unknown
  category: string | null
  diagnosis: string | null
  medication: string | null
  dose: string | null
  source: string
  import_key: string | null
}

export interface TreatmentValue {
  import_key: string
  case_key: string
  animal_id: string | null
  ear_tag: string | null
  animal_name: string | null
  category: JournalCategory
  entry_date: string
  treatment_time: string | null
  last_date: string | null
  body_system: string | null
  diagnosis: string | null
  medication: string | null
  dose: string | null
  applications: number | null
  withdrawal_milk_days: number | null
  withdrawal_meat_days: number | null
  withdrawal_factor: number | null
  release_milk_date: string | null
  release_meat_date: string | null
  administered_by: string | null
  supplier: string | null
  critical_antibiotic: boolean | null
  antibiogram: boolean | null
  notes: string | null
}

/** "Dolovet ad us. vet., Pulver" → "dolovet" (erstes Wort, für Vergleiche). */
export const medKey = (m: string | null | undefined) => (m ?? '').trim().toLowerCase().split(/[\s,]+/)[0]?.replace(/[^a-zäöüß0-9-]/g, '') ?? ''
const doseKey = (d: string | null | undefined) => (d ?? '').toLowerCase().replace(/\s+/g, '').replace(/,/g, '.').replace(/(\d)\.0(?!\d)/g, '$1')
const SOURCE_LABEL: Record<string, string> = { manual: 'von Hand', import: 'Import', milchwaegung: 'Milchwägung' }

/** Prüft eingefügte Datensätze (rein bis auf die übergebenen Tabellen). */
export function checkTreatments(rows: Record<string, unknown>[], animals: AnimalRow[], existing: ExistingRow[], today = localTodayIso()): CheckedRow[] {
  const byTag = new Map<string, AnimalRow>()
  for (const a of animals) byTag.set(normalizeEarTag(a.ear_tag), a)
  const findByTag = (tag: string) =>
    byTag.get(tag) ?? animals.find((a) => tag.length >= 6 && (normalizeEarTag(a.ear_tag).endsWith(tag) || tag.endsWith(normalizeEarTag(a.ear_tag))))
  const existingKeys = new Set(existing.map((e) => e.import_key).filter(Boolean))
  const seen = new Map<string, number>()
  const categories = new Set(JOURNAL_CATEGORIES.map((c) => c.key))

  return rows.map((row, index) => {
    const problems: string[] = []
    const warnings: string[] = []
    const info: string[] = []
    const extra = unknownFields(row, TREATMENT_FIELDS)
    if (extra.length) warnings.push(`unbekannte Felder ignoriert: ${extra.join(', ')}`)

    // Tier
    const tagRaw = readText(row.ohrmarke)
    const tierRaw = readText(row.tier)
    const tag = tagRaw ? normalizeEarTag(tagRaw) : null
    let animal: AnimalRow | undefined
    if (tag) animal = findByTag(tag)
    if (!animal && tierRaw) {
      const t = tierRaw.toLowerCase()
      const hits = animals.filter((a) => a.name?.toLowerCase() === t || a.lauf_nr?.toLowerCase() === t)
      if (hits.length === 1) animal = hits[0]
      else if (hits.length > 1) problems.push(`"${tierRaw}" passt auf mehrere Tiere — Ohrmarke angeben`)
      else if (!tag) problems.push(`Tier "${tierRaw}" nicht gefunden — Ohrmarke angeben`)
    }
    if (!tag && !tierRaw) problems.push('Ohrmarke oder Tier fehlt')
    if (tag && !animal) info.push('nicht in der Herde — wird mit Ohrmarke und Name gespeichert')
    if (animal && tierRaw && tag && ![animal.name, animal.lauf_nr].some((v) => v?.toLowerCase() === tierRaw.toLowerCase()))
      warnings.push(`Ohrmarke gehört zu ${animal.name ?? animal.ear_tag}, nicht "${tierRaw}"`)

    // Daten
    const date = readDate(row.datum)
    const last = readDate(row.letzte_anwendung)
    const relMilk = readDate(row.freigabe_milch)
    const relMeat = readDate(row.freigabe_fleisch)
    for (const r of [date, last, relMilk, relMeat]) if (r.error) problems.push(r.error)
    if (!date.value && !date.error) problems.push('Datum fehlt')
    if (date.value && date.value > today) problems.push('Datum liegt in der Zukunft')
    if (date.value && date.value < '2000-01-01') problems.push('Datum vor 2000')
    if (date.value && last.value && last.value < date.value) problems.push('letzte Anwendung vor der ersten')
    const time = readText(row.uhrzeit)
    if (time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) problems.push(`Uhrzeit "${time}" ungültig (HH:MM)`)

    const catRaw = (readText(row.kategorie) ?? 'behandlung').toLowerCase() as JournalCategory
    if (!categories.has(catRaw)) problems.push(`Kategorie "${catRaw}" unbekannt`)
    const isTreatment = catRaw === 'behandlung'
    const medication = readText(row.praeparat)
    const diagnosis = readText(row.indikation)
    if (isTreatment && !medication) problems.push('Präparat fehlt (oder kategorie "krankheit" angeben)')
    if (isTreatment && !diagnosis) warnings.push('Indikation fehlt (Pflicht im Behandlungsjournal)')
    if (!isTreatment && !diagnosis && !readText(row.bemerkung)) problems.push('Indikation oder Bemerkung fehlt')

    const nums = {
      anwendungen: readNumber(row.anwendungen),
      frist_milch: readNumber(row.frist_milch),
      frist_fleisch: readNumber(row.frist_fleisch),
      faktor: readNumber(row.faktor),
    }
    for (const [k, r] of Object.entries(nums)) {
      if (r.error) problems.push(`${k}: ${r.error}`)
      else if (r.value != null && r.value < 0) problems.push(`${k} negativ`)
    }
    const factor = nums.faktor.value ?? DEFAULT_WITHDRAWAL_FACTOR
    if (![1, 2].includes(factor)) problems.push('faktor muss 1 oder 2 sein')
    const milk = nums.frist_milch.value
    const meat = nums.frist_fleisch.value
    if (isTreatment && medication) {
      if (milk == null || meat == null) warnings.push('Absetzfrist Milch/Fleisch fehlt (Pflicht) — bitte 0 angeben, wenn keine')
      if (milk != null && milk >= 250) info.push(`Frist Milch ${milk} Tage = nicht für laktierende Tiere`)
      else if (milk != null && milk > 60) warnings.push(`Frist Milch ${milk} Tage ungewöhnlich lang`)
      if (meat != null && meat > 120) warnings.push(`Frist Fleisch ${meat} Tage ungewöhnlich lang`)
      if (!readText(row.menge)) warnings.push('Menge fehlt')
      if (!readText(row.behandelt_durch)) warnings.push('behandelt_durch fehlt (Pflicht im Behandlungsjournal)')
    }
    const base = last.value ?? date.value
    const calcMilk = base ? releaseDate(base, milk, factor) : null
    const calcMeat = base ? releaseDate(base, meat, factor) : null
    // nur bei noch laufenden oder kürzlich abgelaufenen Fristen von Belang
    const recent = addDays(today, -30)
    if (relMilk.value && calcMilk && relMilk.value < calcMilk && calcMilk >= recent) warnings.push(`Freigabe Milch ${fmtDate(relMilk.value)} früher als die Frist ergibt (${fmtDate(calcMilk)})`)
    if (relMeat.value && calcMeat && relMeat.value < calcMeat && calcMeat >= recent) warnings.push(`Freigabe Fleisch ${fmtDate(relMeat.value)} früher als die Frist ergibt (${fmtDate(calcMeat)})`)

    const animalKey = animal?.id ?? tag ?? tierRaw ?? ''
    const dose = readText(row.menge)
    let importKey = ['paste', animalKey, date.value ?? '', catRaw, medKey(medication) || (diagnosis ?? '').toLowerCase(), doseKey(dose)].join('|')
    const label = animal ? [animal.lauf_nr, animal.name].filter(Boolean).join(' ') || shortEarTag(animal.ear_tag) : (readText(row.tiername) ?? (tag ? shortEarTag(tag) : tierRaw ?? '?'))

    // Doppelerfassungen
    let status: CheckedRow['status'] = problems.length ? 'fehler' : 'neu'
    if (status === 'neu') {
      const dup = seen.get(importKey)
      if (dup != null) {
        // eigener Schlüssel je Wiederholung: bleibt bei erneutem Einfügen stabil
        let n = 2
        while (seen.has(`${importKey}#${n}`)) n++
        seen.set(`${importKey}#${n}`, index)
        importKey = `${importKey}#${n}`
        if (existingKeys.has(importKey)) {
          status = 'doppelt'
          problems.push('wurde schon eingefügt')
        } else {
          status = 'aehnlich'
          problems.push(`gleich wie Datensatz ${dup + 1} in diesem Text — nur übernehmen, wenn wirklich zweimal angewendet`)
        }
      } else if (existingKeys.has(importKey)) {
        status = 'doppelt'
        problems.push('wurde schon eingefügt')
      } else {
        const same = existing.filter(
          (e) =>
            isoDate(e.entry_date) === date.value &&
            ((animal && e.animal_id === animal.id) || (tag && e.ear_tag && normalizeEarTag(e.ear_tag) === tag)) &&
            (medication ? medKey(e.medication) === medKey(medication) : !e.medication && (e.diagnosis ?? '').toLowerCase() === (diagnosis ?? '').toLowerCase()),
        )
        const exact = same.find((e) => doseKey(e.dose) === doseKey(dose))
        if (exact) {
          status = 'doppelt'
          problems.push(`bereits im Journal (${SOURCE_LABEL[exact.source] ?? exact.source}${exact.medication ? `: ${exact.medication}` : ''}${exact.dose ? `, ${exact.dose}` : ''})`)
        } else if (same.length) {
          status = 'aehnlich'
          problems.push(`ähnlicher Eintrag am selben Tag: ${same.map((e) => [e.medication ?? e.diagnosis, e.dose].filter(Boolean).join(' ')).join('; ')} — nur übernehmen, wenn es eine zusätzliche Anwendung ist`)
        }
      }
      if (!seen.has(importKey)) seen.set(importKey, index)
    }

    const value: TreatmentValue = {
      import_key: importKey,
      case_key: ['paste', animalKey, readText(row.fall) ?? `${date.value}|${(diagnosis ?? '').toLowerCase()}`].join('|'),
      animal_id: animal?.id ?? null,
      ear_tag: tag ?? (animal ? normalizeEarTag(animal.ear_tag) : null),
      animal_name: animal ? null : (readText(row.tiername) ?? tierRaw),
      category: catRaw,
      entry_date: date.value ?? '',
      treatment_time: time,
      last_date: last.value && last.value !== date.value ? last.value : null,
      body_system: readText(row.organ),
      diagnosis,
      medication: isTreatment ? medication : null,
      dose: isTreatment ? dose : null,
      applications: nums.anwendungen.value,
      withdrawal_milk_days: isTreatment ? milk : null,
      withdrawal_meat_days: isTreatment ? meat : null,
      withdrawal_factor: isTreatment ? factor : null,
      release_milk_date: isTreatment ? (relMilk.value ?? calcMilk) : null,
      release_meat_date: isTreatment ? (relMeat.value ?? calcMeat) : null,
      administered_by: readText(row.behandelt_durch),
      supplier: readText(row.abgabestelle),
      critical_antibiotic: readBool(row.kritisches_antibiotikum),
      antibiogram: readBool(row.antibiogramm),
      notes: readText(row.bemerkung),
    }
    const until = (r: string | null) => (r ? fmtDate(addDays(r, -1)) : null)
    return {
      index,
      status,
      title: `${date.value ? fmtDate(date.value) : '?'}${time ? ` ${time}` : ''} · ${label} · ${medication ?? diagnosis ?? catRaw}`,
      detail: [
        diagnosis && medication ? diagnosis : null,
        dose,
        value.last_date ? `bis ${fmtDate(value.last_date)}` : null,
        isTreatment && (milk != null || meat != null) ? `Frist ${factor > 1 ? `${factor}× ` : ''}${milk ?? '–'}/${meat ?? '–'} T.` : null,
        value.release_milk_date ? `Milch gesperrt bis ${until(value.release_milk_date)}` : null,
        value.release_meat_date ? `Fleisch bis ${until(value.release_meat_date)}` : null,
        value.administered_by,
      ]
        .filter(Boolean)
        .join(' · '),
      problems,
      warnings,
      info,
      value,
    }
  })
}

async function loadForCheck(db: PGlite) {
  const [animals, existing] = await Promise.all([
    db.query<AnimalRow>('select id, ear_tag, name, lauf_nr from animals where deleted_at is null'),
    db.query<ExistingRow>(
      `select id, animal_id, ear_tag, entry_date, category, diagnosis, medication, dose, source, import_key from animal_journal
       where deleted_at is null and (medication is not null or category in ('behandlung', 'krankheit') or import_key is not null)`,
    ),
  ])
  return { animals: animals.rows, existing: existing.rows }
}

export async function applyTreatments(db: PGlite, rows: CheckedRow[]): Promise<number> {
  const values = rows.map((r) => r.value as TreatmentValue)
  // nochmals gegen den aktuellen Stand: inzwischen eingefügte nicht doppelt
  const { rows: known } = await db.query<{ import_key: string }>('select import_key from animal_journal where import_key = any($1::text[])', [values.map((v) => v.import_key)])
  const have = new Set(known.map((k) => k.import_key))
  const fresh = values.filter((v) => !have.has(v.import_key))
  await inTransaction(db, async (tx) => {
    for (const v of fresh) {
      const fields = { category: v.category, diagnosis: v.diagnosis, medication: v.medication, dose: v.dose }
      await upsertRow(
        tx,
        'animal_journal',
        {
          id: stableUuid(v.import_key),
          animal_id: v.animal_id,
          entry_date: v.entry_date,
          source: 'import',
          text: v.notes ?? journalSummary(fields),
          ref_id: null,
          ...fields,
          withdrawal_milk_days: v.withdrawal_milk_days,
          withdrawal_meat_days: v.withdrawal_meat_days,
          administered_by: v.administered_by,
          ear_tag: v.ear_tag,
          animal_name: v.animal_name,
          treatment_time: v.treatment_time,
          last_date: v.last_date,
          applications: v.applications,
          supplier: v.supplier,
          body_system: v.body_system,
          withdrawal_factor: v.withdrawal_factor,
          release_milk_date: v.release_milk_date,
          release_meat_date: v.release_meat_date,
          critical_antibiotic: v.critical_antibiotic,
          antibiogram: v.antibiogram,
          case_id: stableUuid(v.case_key),
          import_key: v.import_key,
        },
        { action: 'insert' },
      )
    }
  })
  return fresh.length
}

export function treatmentPasteImporter(moduleKey: string): PasteImporter {
  return {
    area: 'behandlungen',
    label: 'Behandlungen / Tierjournal',
    description:
      'Behandlungsjournal (Tierarzneimittel) und weitere Tierjournal-Einträge. Je Präparat ein Datensatz; Präparate desselben Falls mit gleichem "fall". ' +
      'Freigabe = letzte Anwendung + Frist × Faktor + 1 Tag, wenn nicht angegeben. Doppelte (gleiches Tier, Tag, Präparat, Menge) werden erkannt und übersprungen.',
    permission: `${moduleKey}:animals:write`,
    fields: TREATMENT_FIELDS,
    example: EXAMPLE,
    check: async (db, rows) => {
      const { animals, existing } = await loadForCheck(db)
      return checkTreatments(rows, animals, existing)
    },
    apply: applyTreatments,
  }
}
