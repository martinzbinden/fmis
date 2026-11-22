// Parzellen (aktuelles Jahr) für die Suche über alles (core/frontend/src/search.ts).
import { textRank, type SearchHit } from '@fmis/core/search'
import { getDb } from '../db/pglite'

export async function searchParcels(q: string): Promise<SearchHit[]> {
  const pg = await getDb()
  const { rows } = await pg.query<{ id: string; name: string; area_a: number | string | null; kultur_name_de: string | null }>(
    `select id, name, area_a, kultur_name_de from parcels
     where deleted_at is null and season_year = (select max(season_year) from parcels where deleted_at is null)`,
  )
  return rows.flatMap((p) => {
    const rank = textRank(q, p.name, p.kultur_name_de)
    if (rank == null) return []
    const area = p.area_a == null ? null : `${(Number(p.area_a) / 100).toLocaleString('de-CH', { maximumFractionDigits: 2 })} ha`
    return [{ key: `pz:${p.id}`, group: 'flaechen' as const, title: p.name, subtitle: [area, p.kultur_name_de].filter(Boolean).join(' · ') || undefined, icon: 'parzelle', to: `/wiesenjournal/parzelle/${p.id}`, rank }]
  })
}
