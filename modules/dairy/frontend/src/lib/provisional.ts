// Jungtiere, die noch auf die Ohrmarke warten, wie Tiere wählen (Beobachtung/Behandlung usw.): unter der
// provisorischen Nummer «Mutter-Laufnummer–Nummer im Wurf» (lib/lambs.ts provisionalNr), an die Mutter geknüpft.
// Einträge tragen offspring_id (schema/0028) und gehen beim Erfassen der Ohrmarke ans Tier (earTagPending.ts
// adoptJournal).

import type { PGlite } from '@electric-sql/pglite'
import { shortEarTag } from '@fmis/core/earTag'
import { loadLambs, provisionalNr } from './lambs'
import { localTodayIso } from './format'
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
