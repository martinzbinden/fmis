// Behandlungsjournal schreiben: Behandlung (ein Fall, ein oder mehrere
// Präparate, ein oder mehrere Tiere), cownect-Import, Favoriten.

import type { PGlite } from '@electric-sql/pglite'
import { upsertRow, softDeleteRow } from '../db/write'
import { inTransaction } from '../db/transaction'
import { journalSummary } from './journal'
import { releaseDate, stableUuid, type ImportedTreatment } from './treatments'
import type { TemplateItem, TreatmentTemplate } from '../types'

export interface TreatmentInput {
  animalIds: string[]
  date: string
  time: string | null
  body_system: string | null
  diagnosis: string | null
  items: TemplateItem[]
  administered_by: string | null
  supplier: string | null
  /** 2 = doppelte Absetzfrist (Bio) */
  factor: number
  notes: string | null
}

const lastDateOf = (date: string, days: number | null) => {
  if (!days || days <= 1) return null
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days - 1)
  return d.toISOString().slice(0, 10)
}

/** Zeilen einer Behandlung (je Tier × Präparat), Freigabedaten gerechnet. */
export function treatmentRows(input: TreatmentInput, newId: () => string = () => crypto.randomUUID()) {
  return input.animalIds.flatMap((animalId) => {
    const caseId = newId()
    return input.items.map((it) => {
      const last = lastDateOf(input.date, it.days)
      const fields = {
        category: 'behandlung' as const,
        diagnosis: input.diagnosis,
        medication: it.medication.trim(),
        dose: it.dose.trim() || null,
      }
      return {
        id: newId(),
        animal_id: animalId,
        entry_date: input.date,
        source: 'manual',
        text: input.notes?.trim() || journalSummary(fields),
        ref_id: null,
        ...fields,
        withdrawal_milk_days: it.milk_days,
        withdrawal_meat_days: it.meat_days,
        administered_by: input.administered_by,
        treatment_time: input.time,
        last_date: last,
        applications: it.applications,
        supplier: input.supplier,
        body_system: input.body_system,
        withdrawal_factor: input.factor,
        release_milk_date: releaseDate(last ?? input.date, it.milk_days, input.factor),
        release_meat_date: releaseDate(last ?? input.date, it.meat_days, input.factor),
        critical_antibiotic: null,
        antibiogram: null,
        case_id: caseId,
        import_key: null,
      }
    })
  })
}

export async function saveTreatment(db: PGlite, input: TreatmentInput): Promise<number> {
  const rows = treatmentRows(input)
  await inTransaction(db, async (tx) => {
    for (const r of rows) await upsertRow(tx, 'animal_journal', r, { action: 'insert' })
  })
  return rows.length
}

/** cownect-Behandlungen importieren: nur neue Zeilen (import_key), nie
 * überschreiben oder löschen. Tiere über die Ohrmarke; Tiere ausserhalb der
 * Herde (Kälber, abgegangene) mit Ohrmarke und Name. */
export async function importTreatments(db: PGlite, items: ImportedTreatment[]): Promise<{ added: number; existing: number; matched: number }> {
  const [{ rows: animals }, { rows: known }] = await Promise.all([
    db.query<{ id: string; ear_tag: string }>('select id, ear_tag from animals where deleted_at is null'),
    db.query<{ import_key: string }>('select import_key from animal_journal where import_key is not null'),
  ])
  const byTag = new Map(animals.map((a) => [a.ear_tag.replace(/[\s.]/g, '').toUpperCase(), a.id]))
  const have = new Set(known.map((k) => k.import_key))
  const fresh = items.filter((i) => !have.has(i.import_key))
  let matched = 0
  await inTransaction(db, async (tx) => {
    for (const it of fresh) {
      const animalId = byTag.get(it.ear_tag) ?? null
      if (animalId) matched++
      const fields = { category: it.medication ? ('behandlung' as const) : ('krankheit' as const), diagnosis: it.diagnosis, medication: it.medication, dose: it.dose }
      await upsertRow(
        tx,
        'animal_journal',
        {
          id: stableUuid(it.import_key),
          animal_id: animalId,
          entry_date: it.entry_date,
          source: 'import',
          text: it.info ?? journalSummary(fields),
          ref_id: null,
          ...fields,
          withdrawal_milk_days: it.withdrawal_milk_days,
          withdrawal_meat_days: it.withdrawal_meat_days,
          administered_by: it.administered_by,
          ear_tag: it.ear_tag,
          animal_name: it.animal_name,
          treatment_time: null,
          last_date: it.last_date,
          applications: it.applications,
          supplier: it.supplier,
          body_system: it.body_system,
          withdrawal_factor: it.withdrawal_factor,
          release_milk_date: it.release_milk_date,
          release_meat_date: it.release_meat_date,
          critical_antibiotic: it.critical_antibiotic,
          antibiogram: it.antibiogram,
          case_id: stableUuid(it.case_key),
          import_key: it.import_key,
        },
        { action: 'insert' },
      )
    }
  })
  return { added: fresh.length, existing: items.length - fresh.length, matched }
}

export async function saveTemplate(db: PGlite, t: Omit<TreatmentTemplate, 'updated_at' | 'deleted_at'>): Promise<void> {
  await upsertRow(db, 'treatment_templates', { ...t, deleted_at: null })
}

export const deleteTemplate = (db: PGlite, id: string) => softDeleteRow(db, 'treatment_templates', id)

export interface TreatmentContext {
  templates: TreatmentTemplate[]
  /** Präparate mit Menge und Fristen der letzten Anwendung */
  medications: { medication: string; dose: string | null; applications: number | null; milk_days: number | null; meat_days: number | null }[]
  suppliers: string[]
  persons: string[]
  /** häufigster Faktor der letzten 12 Monate (2 = Bio) */
  usualFactor: number
}

export async function loadTreatmentContext(db: PGlite): Promise<TreatmentContext> {
  const [templates, meds, suppliers, persons, factors] = await Promise.all([
    db.query<TreatmentTemplate>('select * from treatment_templates where deleted_at is null order by sort_order, title'),
    db.query<{ medication: string; dose: string | null; applications: number | null; milk_days: number | null; meat_days: number | null }>(
      `select distinct on (medication) medication, dose, applications, withdrawal_milk_days as milk_days, withdrawal_meat_days as meat_days
       from animal_journal where category = 'behandlung' and medication is not null and medication <> '' and deleted_at is null
       order by medication, entry_date desc`,
    ),
    db.query<{ v: string }>(`select supplier as v from animal_journal where supplier is not null and deleted_at is null group by supplier order by count(*) desc`),
    db.query<{ v: string }>(`select administered_by as v from animal_journal where administered_by is not null and deleted_at is null group by administered_by order by max(entry_date) desc`),
    db.query<{ f: number; n: number }>(
      `select coalesce(withdrawal_factor, 1) as f, count(*)::int as n from animal_journal
       where category = 'behandlung' and deleted_at is null and entry_date > current_date - 365 group by 1 order by n desc`,
    ),
  ])
  return {
    templates: templates.rows,
    medications: meds.rows.map((m) => ({ ...m, applications: m.applications == null ? null : Number(m.applications) })),
    suppliers: suppliers.rows.map((r) => r.v),
    persons: persons.rows.map((r) => r.v),
    usualFactor: Number(factors.rows[0]?.f ?? 1),
  }
}
