// Treffer dieses Moduls für die Suche über alles (core/frontend/src/search.ts): Merklisten. Tiere kommen über den
// AnimalProvider (lib/animalProvider.ts, searchLinks), Funktionen über ModuleDescriptor.functions.

import { textRank, type SearchHit } from '@fmis/core/search'
import { getDb } from '../db/pglite'

export async function searchWatchlists(moduleKey: string, title: string, q: string): Promise<SearchHit[]> {
  const pg = await getDb(moduleKey)
  const { rows } = await pg.query<{ id: string; name: string; n: number }>(
    `select l.id, l.name, count(e.id)::int as n
     from watchlists l
     left join watchlist_entries e on e.list_id = l.id and e.deleted_at is null and e.done_at is null
     where l.deleted_at is null and l.archived_at is null
     group by l.id, l.name`,
  )
  return rows.flatMap((l) => {
    const rank = textRank(q, l.name)
    if (rank == null) return []
    return [{ key: `w:${moduleKey}:${l.id}`, group: 'gruppen' as const, title: l.name, subtitle: `Merkliste · ${l.n} Tiere · ${title}`, icon: 'merkliste', to: `/${moduleKey}/merklisten`, rank }]
  })
}

/** Ziel und Direktknöpfe eines Tier-Treffers. */
export function animalSearchLinks(moduleKey: string, id: string) {
  const at = (path: string) => `/${moduleKey}/${path}?tier=${encodeURIComponent(id)}`
  return {
    to: at('tierinfo'),
    actions: [
      { label: 'Behandlung', icon: 'behandlung', to: at('journal') },
      { label: 'Belegung', icon: 'belegung', to: at('belegung') },
      { label: 'Geburt', icon: 'geburt', to: at('geburt') },
      { label: 'Leistung', icon: 'milch', to: at('leistung') },
    ],
  }
}
