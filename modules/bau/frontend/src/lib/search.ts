// Bauprojekte für die Suche über alles (core/frontend/src/search.ts).
import { textRank, type SearchHit } from '@fmis/core/search'
import { getDb } from '../db/pglite'

export async function searchProjects(q: string): Promise<SearchHit[]> {
  const pg = await getDb()
  const { rows } = await pg.query<{ id: string; name: string; location: string | null; contractor: string | null }>(
    'select id, name, location, contractor from projects where deleted_at is null',
  )
  return rows.flatMap((p) => {
    const rank = textRank(q, p.name, p.location, p.contractor)
    if (rank == null) return []
    return [{ key: `bp:${p.id}`, group: 'bau' as const, title: p.name, subtitle: p.location ?? undefined, icon: '🏗️', to: `/bau/projekt/${p.id}`, rank }]
  })
}
