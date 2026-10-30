// Ohrmarken nachtragen (pages/EarTagPending.tsx): lebende Nachkommen, die bei der
// Geburtserfassung noch keine Ohrmarke hatten (schema/0018).

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { softDeleteRow, upsertRow } from '../db/write'
import { isoDate } from './format'
import { addOffspringAnimal, compactEarTag, pedigreeEnsurer } from './recordBirth'
import type { Animal } from '../types'

export interface PendingOffspring {
  id: string
  birth_id: string
  birth_date: string
  birth_import_key: string | null
  dam_id: string
  sire_key: string | null
  sex: 'w' | 'm' | null
  /** Wurfgrösse (inkl. tote) und Ohrmarken der schon markierten Geschwister */
  litter: number
  siblings: string[]
}

/** Markierfrist nach der Geburt (TVD): Schafe 30 Tage, Rinder 20 Tage. */
export const MARKING_DAYS: Record<'sheep' | 'cattle', number> = { sheep: 30, cattle: 20 }

/** Lebende Nachkommen ohne Ohrmarke, älteste Geburt zuerst. */
export async function loadPendingOffspring(pg: PGlite): Promise<PendingOffspring[]> {
  const { rows } = await pg.query<Record<string, unknown>>(
    `select o.id, o.birth_id, o.ear_tag, o.sex, o.stillborn, o.died_24h, o.died_on, o.import_key,
            b.birth_date, b.import_key as birth_import_key, b.dam_id, b.sire_key
     from birth_offspring o join births b on b.id = o.birth_id
     where o.deleted_at is null and b.deleted_at is null
     order by b.birth_date, b.dam_id, o.import_key`,
  )
  const byBirth = new Map<string, Record<string, unknown>[]>()
  for (const r of rows) byBirth.set(String(r.birth_id), [...(byBirth.get(String(r.birth_id)) ?? []), r])
  const out: PendingOffspring[] = []
  for (const litter of byBirth.values()) {
    for (const r of litter) {
      if (r.ear_tag || r.stillborn || r.died_24h || r.died_on) continue
      out.push({
        id: String(r.id),
        birth_id: String(r.birth_id),
        birth_date: isoDate(r.birth_date)!,
        birth_import_key: (r.birth_import_key as string | null) ?? null,
        dam_id: String(r.dam_id),
        sire_key: (r.sire_key as string | null) ?? null,
        sex: (r.sex as 'w' | 'm' | null) ?? null,
        litter: litter.length,
        siblings: litter.filter((o) => o.ear_tag).map((o) => String(o.ear_tag)),
      })
    }
  }
  return out
}

/** Prüft die nachgetragene Ohrmarke. Gibt es das Tier schon mit demselben Geburtsdatum
 * (z.B. aus dem TVD-Import), wird der Nachkomme damit verknüpft statt neu angelegt. */
export function checkEarTag(p: Pick<PendingOffspring, 'birth_date'>, earTag: string, animals: Animal[]): { error: string } | { existing: Animal | null } {
  const key = animalKey(earTag)
  if (!key) return { error: 'Ohrmarke ungültig.' }
  const existing = animals.find((a) => animalKey(a.ear_tag) === key) ?? null
  if (existing && isoDate(existing.birth_date) !== p.birth_date) {
    return { error: `Ohrmarke ${earTag} gibt es schon (${existing.lauf_nr ?? existing.name ?? existing.ear_tag}).` }
  }
  return { existing }
}

/** Ohrmarke eintragen: Nachkomme ergänzen, Tier im Bestand anlegen (falls noch nicht vorhanden). */
export async function assignEarTag(
  pg: PGlite,
  p: PendingOffspring,
  input: { earTag: string; sex: 'w' | 'm' | null },
  dam: Animal,
  animals: Animal[],
): Promise<{ animalId: string; created: boolean }> {
  const check = checkEarTag(p, input.earTag, animals)
  if ('error' in check) throw new Error(check.error)
  const earTag = compactEarTag(input.earTag)
  const key = animalKey(earTag)!
  const { rows } = await pg.query<Record<string, unknown>>('select * from birth_offspring where id = $1', [p.id])
  if (!rows[0]) throw new Error('Nachkomme nicht gefunden.')
  const importKey = p.birth_import_key ? `${p.birth_import_key}|${key}` : rows[0].import_key
  // Hat ein Herdebuch-Import dieselbe Geburt schon mit Ohrmarke gebracht, die Pendenz dort zusammenführen.
  const { rows: dup } = await pg.query<{ id: string }>(
    'select id from birth_offspring where import_key = $1 and id <> $2 and deleted_at is null',
    [importKey, p.id],
  )
  if (dup.length > 0) await softDeleteRow(pg, 'birth_offspring', p.id)
  else await upsertRow(pg, 'birth_offspring', { ...rows[0], id: p.id, ear_tag: earTag, animal_key: key, sex: input.sex, import_key: importKey })
  if (check.existing) return { animalId: check.existing.id, created: false }
  const ensurePedigree = await pedigreeEnsurer(pg)
  const animalId = await addOffspringAnimal(pg, ensurePedigree, { earTag, key, sex: input.sex, birth_date: p.birth_date, dam, sireKey: p.sire_key })
  return { animalId, created: true }
}

/** Vor dem Markieren verendet: schliesst die Pendenz. */
export async function markDied(pg: PGlite, p: Pick<PendingOffspring, 'id'>, date: string): Promise<void> {
  const { rows } = await pg.query<Record<string, unknown>>('select * from birth_offspring where id = $1', [p.id])
  if (!rows[0]) throw new Error('Nachkomme nicht gefunden.')
  await upsertRow(pg, 'birth_offspring', { ...rows[0], id: p.id, died_on: date })
}

/** Tage seit der Geburt (Ortszeit-Datum). */
export function daysSince(birthIso: string, todayIso: string): number {
  return Math.round((Date.parse(todayIso) - Date.parse(birthIso)) / 86_400_000)
}
