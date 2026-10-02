// SMG-Abstammungs- und Leistungsausweis (lib/smgCertificate.ts) in Stammbaum
// und Zuchtwerte übernehmen. Bestehende Stammbaum-Einträge (Herdebuch-Export,
// Erfassung) werden nur in leeren Feldern ergänzt, nie überschrieben;
// widersprüchliche Eltern ergeben eine Warnung. Zuchtwerte gehen nach
// pedigree_breeding_values (Schlüssel animal_key, neuester Stand je Merkmal).

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'
import { isoDate, num } from './format'
import type { CertificateAnimal, SmgCertificate } from './smgCertificate'

export interface CertificateImportResult {
  subject: string
  pedigreeWritten: number
  breedingValuesWritten: number
  warnings: string[]
}

const TRAITS = ['idx_milk', 'idx_fat_pct', 'idx_protein_pct', 'gzw'] as const

const keyOf = (a: CertificateAnimal) => animalKey(a.ear_tag) ?? a.ear_tag

export async function importCertificate(pg: PGlite, cert: SmgCertificate): Promise<CertificateImportResult> {
  const nodes = [cert.subject, ...cert.ancestors]
  const byPosition = new Map(nodes.map((n) => [n.position, n]))
  const keys = nodes.map(keyOf)
  const warnings: string[] = []

  const { rows: existing } = await pg.query<Record<string, unknown>>('select * from pedigree where animal_key = any($1)', [keys])
  const prevByKey = new Map(existing.map((r) => [String(r.animal_key), r]))

  let pedigreeWritten = 0
  for (const n of nodes) {
    const key = keyOf(n)
    const sire = byPosition.get(`${n.position}S`)
    const dam = byPosition.get(`${n.position}D`)
    const fresh: Record<string, unknown> = {
      name: n.name,
      birth_date: n.birth_date,
      breed_code: n.breed_code,
      sex: n.position === '' ? null : n.position.endsWith('S') ? 'm' : 'w',
      sire_key: sire ? keyOf(sire) : null,
      dam_key: dam ? keyOf(dam) : null,
    }
    const prev = prevByKey.get(key)
    if (prev?.deleted_at) continue
    if (!prev) {
      await upsertRow(pg, 'pedigree', {
        id: crypto.randomUUID(),
        animal_key: key,
        ear_tag: n.ear_tag,
        ...fresh,
        source: 'import',
      })
      pedigreeWritten++
      continue
    }
    const row: Record<string, unknown> & { id: string } = {
      ...prev,
      id: String(prev.id),
      birth_date: isoDate(prev.birth_date),
    }
    let changed = false
    for (const [field, value] of Object.entries(fresh)) {
      if (value == null) continue
      if (row[field] == null) {
        row[field] = value
        changed = true
      } else if ((field === 'sire_key' || field === 'dam_key') && row[field] !== value) {
        warnings.push(`${n.name ?? n.ear_tag}: ${field === 'sire_key' ? 'Vater' : 'Mutter'} im Stammbaum ${row[field]}, im Ausweis ${value} — nicht geändert.`)
      }
    }
    if (changed) {
      await upsertRow(pg, 'pedigree', row)
      pedigreeWritten++
    }
  }

  const { rows: bvRows } = await pg.query<Record<string, unknown>>(
    'select * from pedigree_breeding_values where animal_key = any($1)',
    [keys],
  )
  const prevBv = new Map(bvRows.map((r) => [String(r.import_key), r]))
  let breedingValuesWritten = 0
  for (const n of nodes) {
    const bv = n.breeding_values
    if (!bv) continue
    const key = keyOf(n)
    const evalDate = cert.document_date?.startsWith(String(bv.year)) ? cert.document_date : `${bv.year}-01-01`
    for (const trait of TRAITS) {
      const importKey = `${key}|${trait}`
      const prev = prevBv.get(importKey)
      if (prev?.deleted_at) continue
      const prevDate = isoDate(prev?.eval_date)
      // Ein älterer Ausweis überschreibt keinen neueren Stand.
      if (prev && prevDate && prevDate > evalDate) continue
      if (prev && prevDate === evalDate && num(prev.value) === bv[trait] && num(prev.reliability) === bv.reliability) continue
      await upsertRow(pg, 'pedigree_breeding_values', {
        id: prev ? String(prev.id) : crypto.randomUUID(),
        animal_key: key,
        eval_date: evalDate,
        trait,
        value: bv[trait],
        reliability: bv.reliability,
        source: 'leistungsausweis',
        import_key: importKey,
      })
      breedingValuesWritten++
    }
  }

  return {
    subject: [cert.subject.name, cert.subject.ear_tag].filter(Boolean).join(' '),
    pedigreeWritten,
    breedingValuesWritten,
    warnings,
  }
}
