import type { PGlite } from '@electric-sql/pglite'
import { upsertRow } from '../db/write'
import { animalKey } from '@fmis/core/earTag'
import type { Animal } from '../types'

export type OffspringFate = 'lebend' | 'totgeboren' | 'verendet'

export interface OffspringInput {
  ear_tag: string
  sex: 'w' | 'm' | null
  fate: OffspringFate
  birth_weight_kg: number | null
  /** lebend, Ohrmarke wird später nachgetragen (Pendenz, pages/EarTagPending.tsx) */
  tag_later?: boolean
}

export interface BirthInput {
  dam: Animal
  birth_date: string
  sire: { key: string | null; ear_tag: string; name: string }
  ease: number | null
  conception_date: string | null
  parity: number | null
  notes: string | null
  offspring: OffspringInput[]
}

/** Ohrmarke so ablegen, wie sie auch beim Abgleich verglichen wird: ohne
 * Leerzeichen/Punkte, gross. Eine spätere Langform aus dem Herdebuch-Export
 * ersetzt sie über den gemeinsamen Schlüssel (lib/animalId.ts). */
export function compactEarTag(s: string): string {
  return s.replace(/[\s.]/g, '').toUpperCase()
}

/** Prüft die Nachkommen gegen den Bestand, bevor geschrieben wird. */
export function validateBirth(input: BirthInput, existing: Animal[]): string | null {
  if (input.offspring.length === 0) return 'Mindestens ein Nachkomme.'
  const keys = new Set<string>()
  const existingByKey = new Map(existing.map((a) => [animalKey(a.ear_tag), a]))
  for (const [i, o] of input.offspring.entries()) {
    const key = animalKey(o.ear_tag)
    if (o.fate === 'lebend' && !key && !o.tag_later) return `Nachkomme ${i + 1}: Ohrmarke fehlt – eintragen oder «später» wählen.`
    if (!key) continue
    if (keys.has(key)) return `Ohrmarke ${o.ear_tag} doppelt erfasst.`
    keys.add(key)
    const clash = existingByKey.get(key)
    if (clash) return `Ohrmarke ${o.ear_tag} gibt es schon (${clash.lauf_nr ?? clash.name ?? clash.ear_tag}).`
  }
  return null
}

/** Schreibt Geburt, Nachkommen, neue Tiere (lebende Nachkommen) und deren
 * Stammbaum-Einträge. Die import_keys entsprechen denen des Herdebuch-
 * Imports (lib/importAdis.ts) — ein späterer Export derselben Geburt
 * ergänzt diese Zeilen, statt sie zu verdoppeln. */
export async function recordBirth(pg: PGlite, input: BirthInput): Promise<{ birthId: string; newAnimalIds: string[] }> {
  const damKey = animalKey(input.dam.ear_tag) ?? input.dam.ear_tag
  const birthKey = `${damKey}|${input.birth_date}`
  const birthId = crypto.randomUUID()
  const sireKey = input.sire.key ?? animalKey(input.sire.ear_tag)
  await upsertRow(pg, 'births', {
    id: birthId,
    dam_id: input.dam.id,
    birth_date: input.birth_date,
    parity: input.parity,
    sire_key: sireKey,
    sire_ear_tag: input.sire.ear_tag.trim() || null,
    sire_name: input.sire.name.trim() || null,
    ease: input.ease,
    conception_date: input.conception_date,
    source: 'manual',
    import_key: birthKey,
    notes: input.notes,
  })

  const ensurePedigree = await pedigreeEnsurer(pg)
  await ensurePedigree(damKey, {
    ear_tag: input.dam.ear_tag,
    name: input.dam.name,
    breed_code: input.dam.breed_code,
    birth_date: input.dam.birth_date,
    sex: 'w',
  })
  if (sireKey) {
    await ensurePedigree(sireKey, { ear_tag: input.sire.ear_tag.trim() || sireKey, name: input.sire.name.trim() || null, sex: 'm' })
  }

  const newAnimalIds: string[] = []
  for (const [i, o] of input.offspring.entries()) {
    const earTag = o.ear_tag.trim() ? compactEarTag(o.ear_tag) : null
    const key = animalKey(earTag)
    await upsertRow(pg, 'birth_offspring', {
      id: crypto.randomUUID(),
      birth_id: birthId,
      ear_tag: earTag,
      animal_key: key,
      sex: o.sex,
      stillborn: o.fate === 'totgeboren',
      died_24h: o.fate === 'verendet',
      birth_weight_kg: o.birth_weight_kg,
      import_key: `${birthKey}|${key ?? `#${i}`}`,
      died_on: null,
    })
    if (o.fate !== 'lebend' || !earTag || !key) continue
    newAnimalIds.push(await addOffspringAnimal(pg, ensurePedigree, { earTag, key, sex: o.sex, birth_date: input.birth_date, dam: input.dam, sireKey }))
  }
  return { birthId, newAnimalIds }
}

type EnsurePedigree = (key: string, row: Record<string, unknown>) => Promise<void>

/** Legt Stammbaum-Einträge nur an, wenn es den Schlüssel noch nicht gibt. */
export async function pedigreeEnsurer(pg: PGlite): Promise<EnsurePedigree> {
  const { rows } = await pg.query<{ animal_key: string }>('select animal_key from pedigree where deleted_at is null')
  const known = new Set(rows.map((r) => r.animal_key))
  return async (key, row) => {
    if (known.has(key)) return
    known.add(key)
    await upsertRow(pg, 'pedigree', {
      id: crypto.randomUUID(),
      animal_key: key,
      sire_key: null,
      dam_key: null,
      breed_code: null,
      name: null,
      birth_date: null,
      sex: null,
      source: 'manual',
      ...row,
    })
  }
}

/** Lebender Nachkomme mit Ohrmarke → Tier im Bestand und im Stammbaum. */
export async function addOffspringAnimal(
  pg: PGlite,
  ensurePedigree: EnsurePedigree,
  o: { earTag: string; key: string; sex: 'w' | 'm' | null; birth_date: string; dam: Pick<Animal, 'ear_tag' | 'breed_code'>; sireKey: string | null },
): Promise<string> {
  const animalId = crypto.randomUUID()
  await upsertRow(pg, 'animals', {
    id: animalId,
    ear_tag: o.earTag,
    name: null,
    breed_code: o.dam.breed_code,
    birth_date: o.birth_date,
    sex: o.sex,
    status: 'aktiv',
    entry_date: o.birth_date,
    exit_date: null,
    notes: null,
    lauf_nr: null,
  })
  await ensurePedigree(o.key, {
    ear_tag: o.earTag,
    sire_key: o.sireKey,
    dam_key: animalKey(o.dam.ear_tag) ?? o.dam.ear_tag,
    breed_code: o.dam.breed_code,
    birth_date: o.birth_date,
    sex: o.sex,
  })
  return animalId
}
