// Erfasste Geburt nachträglich bearbeiten (components/BirthEdit.tsx): Datum, Vater, Verlauf, Bemerkung und die
// Nachkommen (Geschlecht, Verbleib, Gewicht, Ohrmarke nachtragen, weiteres Jungtier, vergessenes entfernen).
// Datum und Vater nur bei selbst erfassten Geburten: Beim Herdebuch-Import (lib/importAdis.ts) hängt der Abgleich am
// import_key «Mutter|Datum», eine Änderung hier würde beim nächsten Import verdoppelt.

import type { PGlite } from '@electric-sql/pglite'
import { animalKey } from '@fmis/core/earTag'
import { softDeleteRow, upsertRow } from '../db/write'
import { assignEarTag } from './earTagPending'
import { isoDate, num } from './format'
import { addOffspringAnimal, compactEarTag, offspringProblem, pedigreeEnsurer, type OffspringFate } from './recordBirth'
import type { Animal } from '../types'

export interface EditOffspring {
  /** null = neu */
  id: string | null
  ear_tag: string
  sex: 'w' | 'm' | null
  fate: OffspringFate
  birth_weight_kg: number | null
  /** lebend, Ohrmarke später (nur neue) */
  tag_later?: boolean
  /** Tier im Bestand angelegt: Verbleib nur noch über die Tierseite (Abgang) */
  animalId: string | null
  /** Ohrmarke war beim Laden schon gesetzt */
  tagged: boolean
  /** nach der Geburt verendet (died_on), bleibt unverändert */
  diedOn: string | null
  remove?: boolean
}

export interface EditBirth {
  id: string
  dam: Animal
  manual: boolean
  birth_date: string
  sire: { key: string | null; ear_tag: string; name: string }
  ease: number | null
  notes: string
  offspring: EditOffspring[]
}

export async function loadBirthForEdit(pg: PGlite, birthId: string, animals: Animal[]): Promise<EditBirth | null> {
  const [b, o] = await Promise.all([
    pg.query<Record<string, unknown>>('select * from births where id = $1 and deleted_at is null', [birthId]),
    pg.query<Record<string, unknown>>('select * from birth_offspring where birth_id = $1 and deleted_at is null order by import_key', [birthId]),
  ])
  const row = b.rows[0]
  const dam = row && animals.find((a) => a.id === row.dam_id)
  if (!row || !dam) return null
  const byKey = new Map(animals.filter((a) => !a.deleted_at).map((a) => [animalKey(a.ear_tag), a.id]))
  return {
    id: birthId,
    dam,
    manual: row.source === 'manual',
    birth_date: isoDate(row.birth_date)!,
    sire: { key: (row.sire_key as string | null) ?? null, ear_tag: (row.sire_ear_tag as string | null) ?? '', name: (row.sire_name as string | null) ?? '' },
    ease: num(row.ease),
    notes: (row.notes as string | null) ?? '',
    offspring: o.rows.map((r) => {
      const tag = (r.ear_tag as string | null) ?? ''
      const key = animalKey(tag)
      return {
        id: String(r.id),
        ear_tag: tag,
        sex: (r.sex as 'w' | 'm' | null) ?? null,
        fate: r.stillborn ? 'totgeboren' : r.died_24h ? 'verendet' : 'lebend',
        birth_weight_kg: num(r.birth_weight_kg),
        animalId: (key && byKey.get(key)) || null,
        tagged: !!tag,
        diedOn: isoDate(r.died_on),
      }
    }),
  }
}

/** Prüft die Änderungen gegen den Bestand; null = in Ordnung. */
export function validateBirthEdit(edit: EditBirth, before: EditBirth, animals: Animal[], otherBirthDates: string[], today: string): string | null {
  if (edit.birth_date > today) return 'Das Datum liegt in der Zukunft.'
  if (edit.birth_date !== before.birth_date && otherBirthDates.includes(edit.birth_date)) return `Am ${edit.birth_date} ist für dieses Tier schon eine Geburt erfasst.`
  const kept = edit.offspring.filter((o) => !o.remove)
  if (kept.length === 0) return 'Mindestens ein Nachkomme bleibt. Die ganze Geburt löschst du auf der Tierseite.'
  const keys = new Set<string>()
  for (const [i, o] of kept.entries()) {
    const key = animalKey(o.ear_tag)
    if (key && keys.has(key)) return `Ohrmarke ${o.ear_tag} doppelt erfasst.`
    if (key) keys.add(key)
    // schon gesetzte Ohrmarke und angelegte Tiere nicht erneut gegen den Bestand prüfen
    if (o.tagged || o.animalId) continue
    const p = offspringProblem({ ...o, tag_later: o.tag_later || (o.id != null && !o.ear_tag.trim()) }, animals, `Nachkomme ${i + 1}`)
    if (p) return p
  }
  return null
}

/** Schreibt alle Änderungen. In einer Transaktion aufrufen (inTransaction). */
export async function saveBirthEdit(pg: PGlite, edit: EditBirth, before: EditBirth, animals: Animal[]): Promise<{ added: number; created: number }> {
  const { rows } = await pg.query<Record<string, unknown>>('select * from births where id = $1', [edit.id])
  const birth = rows[0]
  if (!birth) throw new Error('Geburt nicht gefunden.')
  const damKey = animalKey(edit.dam.ear_tag) ?? edit.dam.ear_tag
  const oldBirthKey = (birth.import_key as string | null) ?? null
  const dateChanged = edit.manual && edit.birth_date !== before.birth_date
  const newBirthKey = dateChanged ? `${damKey}|${edit.birth_date}` : oldBirthKey
  const sireKey = edit.manual ? (edit.sire.key ?? animalKey(edit.sire.ear_tag)) : ((birth.sire_key as string | null) ?? null)
  const oldSireKey = (birth.sire_key as string | null) ?? null
  const sireChanged = edit.manual && sireKey !== oldSireKey
  const ensurePedigree = await pedigreeEnsurer(pg)

  await upsertRow(pg, 'births', {
    ...birth,
    id: edit.id,
    birth_date: edit.manual ? edit.birth_date : isoDate(birth.birth_date),
    conception_date: isoDate(birth.conception_date),
    import_key: newBirthKey,
    ...(edit.manual
      ? { sire_key: sireKey, sire_ear_tag: edit.sire.ear_tag.trim() || null, sire_name: edit.sire.name.trim() || null, sire_chosen: sireChanged ? (sireKey ? true : null) : birth.sire_chosen }
      : {}),
    ease: edit.ease,
    notes: edit.notes.trim() || null,
  } as never)
  if (sireChanged && sireKey) await ensurePedigree(sireKey, { ear_tag: edit.sire.ear_tag.trim() || sireKey, name: edit.sire.name.trim() || null, sex: 'm' })

  const offRows = new Map(
    (await pg.query<Record<string, unknown>>('select * from birth_offspring where birth_id = $1 and deleted_at is null', [edit.id])).rows.map((r) => [String(r.id), r]),
  )
  const beforeById = new Map(before.offspring.filter((o) => o.id).map((o) => [o.id!, o]))
  const usedKeys = new Set([...offRows.values()].map((r) => r.import_key as string | null))
  let added = 0
  let created = 0
  const birthDate = edit.manual ? edit.birth_date : before.birth_date
  const reKey = (k: unknown) => (dateChanged && typeof k === 'string' && oldBirthKey && k.startsWith(`${oldBirthKey}|`) ? `${newBirthKey}${k.slice(oldBirthKey.length)}` : k)

  for (const o of edit.offspring) {
    if (o.id == null) {
      if (o.remove) continue
      const earTag = o.ear_tag.trim() ? compactEarTag(o.ear_tag) : null
      const key = animalKey(earTag)
      let importKey = `${newBirthKey ?? edit.id}|${key ?? `#${usedKeys.size}`}`
      for (let i = usedKeys.size; usedKeys.has(importKey); i++) importKey = `${newBirthKey ?? edit.id}|#${i}`
      usedKeys.add(importKey)
      await upsertRow(pg, 'birth_offspring', {
        id: crypto.randomUUID(),
        birth_id: edit.id,
        ear_tag: earTag,
        animal_key: key,
        sex: o.sex,
        stillborn: o.fate === 'totgeboren',
        died_24h: o.fate === 'verendet',
        birth_weight_kg: o.birth_weight_kg,
        import_key: importKey,
        died_on: null,
      })
      added++
      if (o.fate === 'lebend' && earTag && key) {
        await addOffspringAnimal(pg, ensurePedigree, { earTag, key, sex: o.sex, birth_date: birthDate, dam: edit.dam, sireKey })
        created++
      }
      continue
    }
    const row = offRows.get(o.id)
    const prev = beforeById.get(o.id)
    if (!row || !prev) continue
    if (o.remove) {
      if (o.animalId) throw new Error(`Nachkomme ${o.ear_tag} ist im Bestand: Abgang auf der Tierseite erfassen.`)
      const { rows: journal } = await pg.query<{ n: number }>('select count(*)::int as n from animal_journal where offspring_id = $1 and deleted_at is null', [o.id])
      if ((journal[0]?.n ?? 0) > 0) throw new Error('Für diesen Nachkommen gibt es Journal-Einträge; er lässt sich nicht entfernen.')
      await softDeleteRow(pg, 'birth_offspring', o.id)
      continue
    }
    const fateChanged = !o.animalId && o.fate !== prev.fate
    const patch: Record<string, unknown> = {
      sex: o.sex,
      birth_weight_kg: o.birth_weight_kg,
      import_key: reKey(row.import_key),
      ...(fateChanged ? { stillborn: o.fate === 'totgeboren', died_24h: o.fate === 'verendet', died_on: null } : {}),
    }
    const newTag = !prev.tagged && o.ear_tag.trim() ? o.ear_tag.trim() : null
    // Ohrmarke für ein lebendes Jungtier nachtragen: wie unter «Ohrmarken» (Bestand, Vorauswahl, Journal)
    if (newTag && o.fate === 'lebend') {
      await upsertRow(pg, 'birth_offspring', { ...row, id: o.id, ...patch, died_on: isoDate(row.died_on), tvd_reported_on: isoDate(row.tvd_reported_on) } as never)
      const res = await assignEarTag(
        pg,
        { id: o.id, birth_id: edit.id, birth_date: birthDate, birth_import_key: newBirthKey, dam_id: edit.dam.id, sire_key: sireKey, sex: o.sex, litter: 0, dead: 0, siblings: [], members: [], litterIndex: 0 },
        { earTag: newTag, sex: o.sex },
        edit.dam,
        animals,
      )
      if (res.created) created++
      continue
    }
    if (newTag) {
      const earTag = compactEarTag(newTag)
      patch.ear_tag = earTag
      patch.animal_key = animalKey(earTag)
    }
    // tot → lebend mit Ohrmarke: jetzt ins Bestand
    const tag = (patch.ear_tag as string | undefined) ?? (row.ear_tag as string | null)
    const tagKey = animalKey(tag)
    await upsertRow(pg, 'birth_offspring', { ...row, id: o.id, ...patch, died_on: fateChanged ? null : isoDate(row.died_on), tvd_reported_on: isoDate(row.tvd_reported_on) } as never)
    if (!o.animalId && o.fate === 'lebend' && tag && tagKey && (fateChanged || newTag)) {
      await addOffspringAnimal(pg, ensurePedigree, { earTag: tag, key: tagKey, sex: o.sex, birth_date: birthDate, dam: edit.dam, sireKey })
      created++
    }
    if (o.animalId && o.sex !== prev.sex) await patchAnimal(pg, o.animalId, { sex: o.sex })
    if (tagKey && o.sex !== prev.sex) await patchPedigree(pg, tagKey, { sex: o.sex })
  }

  // Datum oder Vater geändert: angelegte Jungtiere und ihr Stammbaum nachführen
  if (dateChanged || sireChanged) {
    for (const o of before.offspring) {
      const key = animalKey(o.ear_tag)
      if (o.animalId && dateChanged) await patchAnimal(pg, o.animalId, { birth_date: edit.birth_date }, before.birth_date)
      if (key) {
        await patchPedigree(pg, key, {
          ...(dateChanged ? { birth_date: edit.birth_date } : {}),
          ...(sireChanged ? { sire_key: sireKey } : {}),
        }, { birth_date: before.birth_date, sire_key: oldSireKey })
      }
    }
  }
  return { added, created }
}

/** Tier nachführen; Geburts-/Zugangsdatum nur, wenn es noch dem alten Geburtsdatum entspricht. */
async function patchAnimal(pg: PGlite, id: string, p: { sex?: 'w' | 'm' | null; birth_date?: string }, oldDate?: string) {
  const { rows } = await pg.query<Record<string, unknown>>('select * from animals where id = $1', [id])
  const a = rows[0]
  if (!a) return
  const birth = isoDate(a.birth_date)
  const entry = isoDate(a.entry_date)
  const next: Record<string, unknown> = { ...a, id, birth_date: birth, entry_date: entry, exit_date: isoDate(a.exit_date) }
  if (p.sex !== undefined) next.sex = p.sex
  if (p.birth_date && birth === oldDate) next.birth_date = p.birth_date
  if (p.birth_date && entry === oldDate) next.entry_date = p.birth_date
  await upsertRow(pg, 'animals', next as never)
}

/** Stammbaum-Eintrag nachführen; ein Feld nur, wenn es noch den alten Wert (oder keinen) hat. */
async function patchPedigree(pg: PGlite, key: string, p: Record<string, unknown>, old: Record<string, unknown> = {}) {
  const { rows } = await pg.query<Record<string, unknown>>('select * from pedigree where animal_key = $1 and deleted_at is null', [key])
  const r = rows[0]
  if (!r) return
  const next: Record<string, unknown> = { ...r, id: String(r.id), birth_date: isoDate(r.birth_date) }
  let changed = false
  for (const [f, v] of Object.entries(p)) {
    const cur = f === 'birth_date' ? isoDate(r[f]) : (r[f] ?? null)
    if (f in old && cur != null && cur !== old[f]) continue
    if (cur === v) continue
    next[f] = v
    changed = true
  }
  if (changed) await upsertRow(pg, 'pedigree', next as never)
}
