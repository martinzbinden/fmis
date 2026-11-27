// Jungtiere, die noch auf die Ohrmarke warten, wie Tiere wählen (Beobachtung/Behandlung usw.): unter der
// provisorischen Nummer «Mutter-Laufnummer–Nummer im Wurf» (lib/lambs.ts provisionalNr), an die Mutter geknüpft.
// Einträge tragen offspring_id (schema/0028) und gehen beim Erfassen der Ohrmarke ans Tier (earTagPending.ts
// adoptJournal).

import type { PGlite } from '@electric-sql/pglite'
import { shortEarTag } from '@fmis/core/earTag'
import { litterIndexOf, loadLambs, provisionalNr } from './lambs'
import { isoDate, localTodayIso } from './format'
import type { Animal } from '../types'

/** Kennung im Tier-Wähler: «o:<offspring_id>» statt einer Tier-id. */
export const PROV_PREFIX = 'o:'
export const isProvisional = (id: string) => id.startsWith(PROV_PREFIX)
export const offspringIdOf = (id: string) => id.slice(PROV_PREFIX.length)

export interface ProvisionalYoung {
  offspringId: string
  nr: string
  damId: string | null
  damLabel: string | null
  sex: 'w' | 'm' | null
  birthDate: string
}

export async function loadProvisionalYoung(pg: PGlite): Promise<ProvisionalYoung[]> {
  const [lambs, dams] = await Promise.all([
    loadLambs(pg, localTodayIso()),
    pg.query<{ id: string; lauf_nr: string | null; ear_tag: string }>('select id, lauf_nr, ear_tag from animals where deleted_at is null'),
  ])
  const damLabel = new Map(dams.rows.map((d) => [d.id, d.lauf_nr ?? shortEarTag(d.ear_tag)]))
  return lambs
    .filter((l) => l.offspringId && !l.animalId && !l.earTag)
    .map((l) => {
      const dl = l.damId ? (damLabel.get(l.damId) ?? null) : null
      return { offspringId: l.offspringId!, nr: provisionalNr(dl, l.litterIndex), damId: l.damId, damLabel: dl, sex: l.sex, birthDate: l.birthDate }
    })
}

/** Als «Tier» für den Tier-Wähler: Nummer = provisorische Nummer, Name sagt «ohne Ohrmarke, Mutter …». */
export function asPickerAnimal(y: ProvisionalYoung): Animal {
  return {
    id: `${PROV_PREFIX}${y.offspringId}`,
    ear_tag: '',
    lauf_nr: y.nr,
    name: `ohne Ohrmarke · Mutter ${y.damLabel ?? '?'}`,
    sex: y.sex,
    birth_date: y.birthDate,
    status: 'aktiv',
  } as unknown as Animal
}

/** Jungtier einer Mutter aus der Geburt (auch verendete), für die Einträge auf der Tierseite der Mutter. */
export interface DamYoung {
  id: string
  birth_id: string
  import_key: string | null
  sex: 'w' | 'm' | null
  stillborn: boolean
  died_24h: boolean
  died_on: string | null
  /** schon mit Ohrmarke (Einträge gehen dann ans Tier) */
  ear_tag: string | null
}

/** Provisorische Nummer und «verendet» je Jungtier (Nummer im Wurf wie lib/lambs.ts buildLambs). */
export function youngLabels(young: DamYoung[], damLabel: string | null): Map<string, { nr: string; dead: boolean; sex: 'w' | 'm' | null }> {
  const litters = new Map<string, string[]>()
  for (const o of [...young].sort((a, b) => (a.import_key ?? a.id).localeCompare(b.import_key ?? b.id))) litters.set(o.birth_id, [...(litters.get(o.birth_id) ?? []), o.id])
  const out = new Map<string, { nr: string; dead: boolean; sex: 'w' | 'm' | null }>()
  for (const o of young) {
    const index = litterIndexOf(o.import_key, (litters.get(o.birth_id)?.indexOf(o.id) ?? 0) + 1)
    out.set(o.id, { nr: provisionalNr(damLabel, index), dead: o.stillborn || o.died_24h || o.died_on != null, sex: o.sex })
  }
  return out
}

/** Alle Jungtiere aus Geburten dieser Mutter (inkl. verendeter) mit provisorischer Nummer. */
export async function loadDamYoung(pg: PGlite, damId: string): Promise<Map<string, { nr: string; dead: boolean; sex: 'w' | 'm' | null; earTag: string | null }>> {
  const [dam, rows] = await Promise.all([
    pg.query<{ lauf_nr: string | null; ear_tag: string }>('select lauf_nr, ear_tag from animals where id = $1', [damId]),
    pg.query<Record<string, unknown>>(
      `select o.id, o.birth_id, o.import_key, o.sex, o.stillborn, o.died_24h, o.died_on, o.ear_tag
       from birth_offspring o join births b on b.id = o.birth_id
       where b.dam_id = $1 and o.deleted_at is null and b.deleted_at is null`,
      [damId],
    ),
  ])
  const d = dam.rows[0]
  const young: DamYoung[] = rows.rows.map((o) => ({
    id: String(o.id),
    birth_id: String(o.birth_id),
    import_key: o.import_key == null ? null : String(o.import_key),
    sex: (o.sex as 'w' | 'm' | null) ?? null,
    stillborn: Boolean(o.stillborn),
    died_24h: Boolean(o.died_24h),
    died_on: isoDate(o.died_on),
    ear_tag: o.ear_tag == null ? null : String(o.ear_tag),
  }))
  const labels = youngLabels(young, d ? (d.lauf_nr ?? shortEarTag(d.ear_tag)) : null)
  return new Map(young.map((o) => [o.id, { ...labels.get(o.id)!, earTag: o.ear_tag }]))
}
