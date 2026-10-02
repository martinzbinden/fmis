// Eigene Mastlämmer aus der Selektion der Milchschafe übernehmen. Gelesen
// wird rein lesend und schema-qualifiziert aus "dairy_schafe" auf der
// gemeinsamen pglite-Datenbank (Muster: modules/wiesenjournal/frontend/src/
// lib/fieldsBackground.ts) — keine SQL-Verknüpfung zwischen den Modulen.
// Geschrieben wird nur über den eigenen Schreibpfad des Mastplaners
// (db/write.ts), damit Sync, Verlauf und Rechte wie bei jedem anderen Tier
// greifen. Das Schema "dairy_schafe" existiert in diesem Browser nur, wenn
// die Milchschafe hier schon geöffnet/synchronisiert wurden.

import type { PGlite } from '@electric-sql/pglite'
import { getSharedDbRaw } from '@fmis/core/db'
import { animalKey } from '@fmis/core/earTag'
import { upsertRow } from '../db/write'

export interface OwnLamb {
  /** Ohrmarke in Kurzform ohne Punkt (CH + 8 Ziffern), wie die übrigen Mastlämmer. */
  ear_tag: string
  birth_date: string | null
  sex: 'm' | 'w'
  dam_ear_tag: string | null
  sire_ear_tag: string | null
  decided_on: string | null
}

const SCHEMA = 'dairy_schafe'

function iso(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

/** Mast-Entscheide aus der Selektion, die im Mastplaner noch fehlen.
 * `null`, wenn die Milchschafe auf diesem Gerät nicht verfügbar sind. */
export async function loadOwnMastLambs(pg: PGlite): Promise<OwnLamb[] | null> {
  let shared: PGlite
  let decisions: { animal_key: string; purpose: string | null; decided_on: unknown }[]
  try {
    shared = await getSharedDbRaw()
    decisions = (
      await shared.query<{ animal_key: string; purpose: string | null; decided_on: unknown }>(
        `select distinct on (animal_key) animal_key, purpose, decided_on
         from "${SCHEMA}"."lamb_selection" where deleted_at is null
         order by animal_key, updated_at desc`,
      )
    ).rows
  } catch {
    return null
  }
  const mast = decisions.filter((d) => d.purpose === 'mast')
  if (mast.length === 0) return []

  const [offspring, animals, pedigree, existing] = await Promise.all([
    shared.query<{ animal_key: string | null; ear_tag: string | null; sex: string | null; birth_date: unknown; sire_key: string | null; dam_tag: string }>(
      `select o.animal_key, o.ear_tag, o.sex, b.birth_date, b.sire_key, d.ear_tag as dam_tag
       from "${SCHEMA}"."birth_offspring" o
       join "${SCHEMA}"."births" b on b.id = o.birth_id and b.deleted_at is null
       join "${SCHEMA}"."animals" d on d.id = b.dam_id
       where o.deleted_at is null`,
    ),
    shared.query<{ ear_tag: string; birth_date: unknown; sex: string | null }>(
      `select ear_tag, birth_date, sex from "${SCHEMA}"."animals" where deleted_at is null`,
    ),
    shared.query<{ animal_key: string; sire_key: string | null; dam_key: string | null }>(
      `select animal_key, sire_key, dam_key from "${SCHEMA}"."pedigree" where deleted_at is null`,
    ),
    pg.query<{ ear_tag: string }>('select ear_tag from animals where deleted_at is null'),
  ])
  const have = new Set(existing.rows.map((a) => animalKey(a.ear_tag)))
  const offspringByKey = new Map(offspring.rows.map((o) => [o.animal_key ?? animalKey(o.ear_tag), o]))
  const animalByKey = new Map(animals.rows.map((a) => [animalKey(a.ear_tag), a]))
  const pedigreeByKey = new Map(pedigree.rows.map((p) => [p.animal_key, p]))

  const lambs: OwnLamb[] = []
  for (const d of mast) {
    if (have.has(d.animal_key)) continue
    const o = offspringByKey.get(d.animal_key)
    const a = animalByKey.get(d.animal_key)
    const p = pedigreeByKey.get(d.animal_key)
    const sex = (o?.sex ?? a?.sex) === 'w' ? 'w' : 'm'
    lambs.push({
      ear_tag: d.animal_key,
      birth_date: iso(o?.birth_date ?? a?.birth_date),
      sex,
      dam_ear_tag: animalKey(o?.dam_tag) ?? p?.dam_key ?? null,
      sire_ear_tag: o?.sire_key ?? p?.sire_key ?? null,
      decided_on: iso(d.decided_on),
    })
  }
  return lambs.sort((x, y) => (x.birth_date ?? '').localeCompare(y.birth_date ?? '') || x.ear_tag.localeCompare(y.ear_tag))
}

/** Legt die Lämmer als aktive Masttiere an (Herkunft "Eigene Zucht") und
 * nimmt sie in eine bestehende oder neue Gruppe auf. */
export async function importOwnLambs(
  lambs: OwnLamb[],
  target: { groupId: string } | { newGroupName: string },
  entryDate: string,
): Promise<number> {
  let groupId: string
  if ('groupId' in target) groupId = target.groupId
  else {
    groupId = crypto.randomUUID()
    await upsertRow('animal_groups', {
      id: groupId,
      name: target.newGroupName,
      created_date: entryDate,
      target_weight_min_kg: 45,
      target_weight_max_kg: 50,
      status: 'aktiv',
      notes: null,
    })
  }
  for (const l of lambs) {
    const animalId = crypto.randomUUID()
    await upsertRow('animals', {
      id: animalId,
      ear_tag: l.ear_tag,
      birth_date: l.birth_date,
      sex: l.sex,
      status: 'aktiv',
      entry_date: entryDate,
      entry_weight_kg: null,
      purchase_cost: 0,
      source_tvd_nr: null,
      source_name: 'Eigene Zucht',
      notes: null,
      dam_ear_tag: l.dam_ear_tag,
      sire_ear_tag: l.sire_ear_tag,
    })
    await upsertRow('group_memberships', {
      id: crypto.randomUUID(),
      animal_id: animalId,
      group_id: groupId,
      start_date: entryDate,
      end_date: null,
    })
  }
  return lambs.length
}
