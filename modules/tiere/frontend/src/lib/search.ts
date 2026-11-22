// Tiergruppen für die Suche über alles (core/frontend/src/search.ts).
import { textRank, type SearchHit } from '@fmis/core/search'
import { getDb } from '../db/pglite'

export async function searchHerds(q: string): Promise<SearchHit[]> {
  const pg = await getDb()
  const { rows } = await pg.query<{ id: string; name: string; species: string | null; active: boolean }>(
    'select id, name, species, active from herd_groups where deleted_at is null',
  )
  return rows.flatMap((g) => {
    const rank = textRank(q, g.name)
    if (rank == null) return []
    return [{ key: `h:${g.id}`, group: 'gruppen' as const, title: g.name, subtitle: `Tiergruppe${g.active ? '' : ' (aufgelöst)'}`, icon: 'gruppen', to: '/tiere', rank: g.active ? rank : rank + 2 }]
  })
}
