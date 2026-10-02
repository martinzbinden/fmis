// SMG-Abstammungs- und Leistungsausweis (lib/smgCertificate.ts) übernehmen:
// Stammbaum, Zuchtwerte, Gesundheit/Genetik, Punktierungen/LBE, Leistungen.
//
// Zweistufig: planCertificateImport() vergleicht mit dem Bestand und listet
// jede Änderung an einem schon vorhandenen Wert als Abweichung (z.B. ein
// neuerer Ausweis mit aktualisierten Zuchtwerten, oder ein Stammbaum-Eintrag
// aus dem Herdebuch-Export, der anders lautet). applyCertificatePlan()
// schreibt dann entweder alles ("überschreiben") oder nur, was neu ist bzw.
// leere Felder füllt ("nur ergänzen"). Ohne Abweichungen gibt es nichts zu
// entscheiden.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey, shortEarTag } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'
import type { SyncTable } from '../db/tables'
import { isoDate, num } from './format'
import type { CertificateAnimal, CertificatePerformance, CertificateScore, SmgCertificate } from './smgCertificate'

type Row = Record<string, unknown> & { id: string }

export interface PlannedWrite {
  table: SyncTable
  /** Zeile mit allen Werten des Ausweises. */
  row: Row
  /** Bei Abweichungen: Zeile, die nur leere Felder füllt (null = nichts zu ergänzen). */
  gapsOnly: Row | null
  /** Abweichende Felder in Klartext ("GZW 101 → 103"); leer = unkritisch. */
  changes: string[]
}

export interface CertificatePlan {
  subject: string
  document_date: string | null
  writes: PlannedWrite[]
  /** Abweichungen je Tier, z.B. "SEPPI 1822.5245: GZW 101 → 103". */
  conflicts: string[]
  /** Der Ausweis ist älter als bereits gespeicherte Angaben. */
  older_than_stored: boolean
}

export interface CertificateImportResult {
  subject: string
  written: number
  skipped: number
}

const BV_TRAITS = ['idx_milk', 'idx_fat_pct', 'idx_protein_pct', 'gzw'] as const

const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  birth_date: 'Geburtsdatum',
  breed_code: 'Rasse',
  sex: 'Geschlecht',
  sire_key: 'Vater',
  dam_key: 'Mutter',
  idx_milk: 'ZW Milch',
  idx_fat_pct: 'ZW Fett %',
  idx_protein_pct: 'ZW Eiweiss %',
  gzw: 'GZW',
  reliability: 'Sicherheit',
  color: 'Farbe',
  maedi_visna: 'Maedi Visna',
  ccr5: 'CCR5',
  scrapie: 'Scrapie',
  parasite_resistance: 'Parasitenresistenz',
  offspring_male: 'Nachkommen männlich',
  offspring_female: 'Nachkommen weiblich',
  offspring_total: 'Nachkommen total',
  offspring_breeding: 'Nachkommen in Zucht',
  age_class: 'Altersklasse',
  format: 'Format',
  fundament: 'Fundament',
  udder: 'Euter',
  teats: 'Zitzen',
  wool: 'Wolle',
  total: 'Gesamtnote',
  defects: 'Fehler',
  remarks: 'Bemerkungen',
  count: 'Anzahl',
  interval_days: 'ZWZ',
  days: 'Tage',
  milk_kg: 'Milch kg',
  fat_pct: 'Fett %',
  fat_kg: 'Fett kg',
  protein_pct: 'Eiweiss %',
  protein_kg: 'Eiweiss kg',
  cell_count: 'Zellzahl',
  persistency: 'Persistenz',
  calving_date: 'Ablammdatum',
  age: 'Alter',
  test_type: 'Prüfart',
  value: 'Wert',
}

const DATE_FIELDS = new Set(['birth_date', 'calving_date', 'score_date', 'document_date', 'eval_date'])

function normalize(field: string, v: unknown): string | number | boolean | null {
  if (v == null || v === '') return null
  if (DATE_FIELDS.has(field)) return isoDate(v)
  if (typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))) return num(v)
  if (typeof v === 'boolean') return v
  return String(v)
}

/** Vergleich Bestand ↔ Ausweis: Felder, die neu gefüllt bzw. geändert würden. */
function diff(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const fills: Record<string, unknown> = {}
  const changes: string[] = []
  for (const [field, value] of Object.entries(next)) {
    const a = normalize(field, prev[field])
    const b = normalize(field, value)
    if (b == null || a === b) continue
    if (a == null) fills[field] = value
    else changes.push(`${FIELD_LABEL[field] ?? field} ${display(field, a)} → ${display(field, b)}`)
  }
  return { fills, changes }
}

function display(field: string, v: string | number | boolean): string {
  if (typeof v === 'string' && DATE_FIELDS.has(field)) return `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}`
  if (field === 'sire_key' || field === 'dam_key') return shortEarTag(String(v))
  return String(v)
}

const withoutEmpty = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''))

const keyOf = (a: CertificateAnimal) => animalKey(a.ear_tag) ?? a.ear_tag
const labelOf = (a: CertificateAnimal) => [a.name, shortEarTag(a.ear_tag)].filter(Boolean).join(' ')

async function byColumn(pg: PGlite, table: string, column: string, values: string[]) {
  const { rows } = await pg.query<Record<string, unknown>>(`select * from ${table} where ${column} = any($1)`, [values])
  return new Map(rows.map((r) => [String(r[column]), r]))
}

/** Bestehende Zeile neu schreiben: volle Zeile mitgeben (upsertRow setzt
 * fehlende Spalten auf null), Datumswerte normalisiert. */
function merge(prev: Record<string, unknown>, patch: Record<string, unknown>): Row {
  const row: Row = { ...prev, id: String(prev.id) }
  for (const f of Object.keys(row)) if (DATE_FIELDS.has(f) && row[f] != null) row[f] = isoDate(row[f])
  return { ...row, ...patch }
}

export async function planCertificateImport(pg: PGlite, cert: SmgCertificate): Promise<CertificatePlan> {
  const nodes = [cert.subject, ...cert.ancestors]
  const byPosition = new Map(nodes.map((n) => [n.position, n]))
  const keys = nodes.map(keyOf)
  const docDate = cert.document_date
  const writes: PlannedWrite[] = []
  const conflictsByAnimal = new Map<string, string[]>()
  let olderThanStored = false

  const add = (animal: CertificateAnimal, table: SyncTable, prev: Record<string, unknown> | undefined, values: Record<string, unknown>, fresh: Row, prevDate?: string | null) => {
    if (!prev) {
      writes.push({ table, row: fresh, gapsOnly: null, changes: [] })
      return
    }
    if (prev.deleted_at) return
    const { fills, changes } = diff(prev, values)
    if (!changes.length && !Object.keys(fills).length) return
    const meta = docDate ? { document_date: docDate } : {}
    if (changes.length) {
      if (prevDate && docDate && prevDate > docDate) olderThanStored = true
      const list = conflictsByAnimal.get(labelOf(animal)) ?? []
      list.push(...changes)
      conflictsByAnimal.set(labelOf(animal), list)
    }
    writes.push({
      table,
      // Leere Werte des Ausweises löschen nichts (Import-Regel: nur ergänzen).
      row: merge(prev, { ...withoutEmpty(values), ...('document_date' in fresh ? meta : {}) }),
      gapsOnly: changes.length ? (Object.keys(fills).length ? merge(prev, fills) : null) : null,
      changes,
    })
  }

  // Stammbaum
  const pedigree = await byColumn(pg, 'pedigree', 'animal_key', keys)
  for (const n of nodes) {
    const key = keyOf(n)
    const sire = byPosition.get(`${n.position}S`)
    const dam = byPosition.get(`${n.position}D`)
    const values = {
      name: n.name,
      birth_date: n.birth_date,
      breed_code: n.breed_code,
      sex: n.position === '' ? null : n.position.endsWith('S') ? 'm' : 'w',
      sire_key: sire ? keyOf(sire) : null,
      dam_key: dam ? keyOf(dam) : null,
    }
    add(n, 'pedigree', pedigree.get(key), values, { id: crypto.randomUUID(), animal_key: key, ear_tag: n.ear_tag, ...values, source: 'import' })
  }

  // Zuchtwerte (je Merkmal eine Zeile, Stand = Ausweisdatum im ZW-Jahr)
  const bvs = await byColumn(pg, 'pedigree_breeding_values', 'import_key', keys.flatMap((k) => BV_TRAITS.map((t) => `${k}|${t}`)))
  for (const n of nodes) {
    const bv = n.breeding_values
    if (!bv) continue
    const key = keyOf(n)
    const evalDate = docDate?.startsWith(String(bv.year)) ? docDate : `${bv.year}-01-01`
    for (const trait of BV_TRAITS) {
      const value = bv[trait]
      if (value == null) continue
      const importKey = `${key}|${trait}`
      const prev = bvs.get(importKey)
      // Feldname = Merkmal, damit die Abweichung "GZW 101 → 103" heisst.
      const shown = prev ? { ...prev, [trait]: prev.value } : undefined
      const fresh: Row = { id: crypto.randomUUID(), animal_key: key, eval_date: evalDate, trait, value, reliability: bv.reliability, source: 'leistungsausweis', import_key: importKey }
      if (!shown) {
        writes.push({ table: 'pedigree_breeding_values', row: fresh, gapsOnly: null, changes: [] })
        continue
      }
      if (shown.deleted_at) continue
      const { changes } = diff(shown, { [trait]: value })
      const sameMeta = normalize('eval_date', prev!.eval_date) === evalDate && num(prev!.reliability) === bv.reliability
      if (!changes.length && sameMeta) continue
      const prevDate = isoDate(prev!.eval_date)
      if (changes.length) {
        if (prevDate && prevDate > evalDate) olderThanStored = true
        const list = conflictsByAnimal.get(labelOf(n)) ?? []
        list.push(...changes)
        conflictsByAnimal.set(labelOf(n), list)
      }
      writes.push({
        table: 'pedigree_breeding_values',
        row: { ...fresh, id: String(prev!.id) },
        gapsOnly: null,
        changes,
      })
    }
  }

  // Gesundheit/Genetik, Nachkommen
  const infos = await byColumn(pg, 'pedigree_info', 'animal_key', keys)
  for (const n of nodes) {
    const values = Object.fromEntries(Object.entries(n.info).filter(([, v]) => v != null))
    if (!Object.keys(values).length) continue
    const key = keyOf(n)
    const prev = infos.get(key)
    add(n, 'pedigree_info', prev, values, {
      id: crypto.randomUUID(),
      animal_key: key,
      ...n.info,
      document_date: docDate,
      source: 'leistungsausweis',
    }, isoDate(prev?.document_date))
  }

  // Punktierungen/LBE und Leistungen: eine Zeile je Datum bzw. Laktation
  const scoreKey = (key: string, s: CertificateScore) => `${key}|${s.kind}|${s.date}`
  const perfKey = (key: string, p: CertificatePerformance) =>
    `${key}|${p.kind}${p.kind === 'laktation' || p.kind === 'toechter' ? `|${p.lactation_number ?? 'mittel'}` : ''}`
  const scores = await byColumn(pg, 'conformation_scores', 'import_key', nodes.flatMap((n) => n.scores.map((s) => scoreKey(keyOf(n), s))))
  const perfs = await byColumn(pg, 'pedigree_performance', 'import_key', nodes.flatMap((n) => n.performance.map((p) => perfKey(keyOf(n), p))))
  for (const n of nodes) {
    const key = keyOf(n)
    for (const s of n.scores) {
      const importKey = scoreKey(key, s)
      const { kind, date, ...values } = s
      const prev = scores.get(importKey)
      add(n, 'conformation_scores', prev, values, {
        id: crypto.randomUUID(),
        animal_key: key,
        score_date: date,
        kind,
        ...values,
        document_date: docDate,
        source: 'leistungsausweis',
        import_key: importKey,
      }, isoDate(prev?.document_date))
    }
    for (const p of n.performance) {
      const importKey = perfKey(key, p)
      const prev = perfs.get(importKey)
      add(n, 'pedigree_performance', prev, { ...p }, {
        id: crypto.randomUUID(),
        animal_key: key,
        ...p,
        document_date: docDate,
        source: 'leistungsausweis',
        import_key: importKey,
      }, isoDate(prev?.document_date))
    }
  }

  return {
    subject: labelOf(cert.subject),
    document_date: docDate,
    writes,
    conflicts: [...conflictsByAnimal].map(([animal, changes]) => `${animal}: ${changes.join(', ')}`),
    older_than_stored: olderThanStored,
  }
}

/** overwrite = true: alle Werte des Ausweises; false: nur Neues und leere Felder. */
export async function applyCertificatePlan(pg: PGlite, plan: CertificatePlan, overwrite: boolean): Promise<CertificateImportResult> {
  let written = 0
  let skipped = 0
  for (const w of plan.writes) {
    const row = w.changes.length && !overwrite ? w.gapsOnly : w.row
    if (!row) {
      skipped++
      continue
    }
    await upsertRow(pg, w.table, row as never)
    written++
  }
  return { subject: plan.subject, written, skipped }
}
