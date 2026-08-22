import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtDate } from '../lib/format'
import type { GroupStatus } from '../types'

interface Row {
  id: string
  name: string
  status: GroupStatus
  created_date: string
  target_weight_min_kg: number
  target_weight_max_kg: number
  member_count: number
}

async function loadGroups(pg: PGlite): Promise<Row[]> {
  const { rows } = await pg.query<Row>(`
    select
      g.id, g.name, g.status, g.created_date,
      g.target_weight_min_kg, g.target_weight_max_kg,
      coalesce(m.member_count, 0) as member_count
    from animal_groups g
    left join (
      select group_id, count(*) as member_count
      from group_memberships
      where deleted_at is null and end_date is null
      group by group_id
    ) m on m.group_id = g.id
    where g.deleted_at is null
    order by g.created_date desc
  `)
  return rows
}

export default function Groups() {
  const { data, loading } = useQuery(loadGroups)

  if (loading && !data) return <div className="p-4 text-center text-gray-400">Lädt…</div>
  const groups = data ?? []

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-3 text-xl font-bold text-gray-800">Gruppen ({groups.length})</h1>
      {groups.length === 0 ? (
        <p className="text-gray-500">Noch keine Gruppen angelegt.</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                to={`/gruppen/${g.id}`}
                className="flex items-center justify-between rounded-lg bg-white p-3 shadow-sm active:bg-gray-50"
              >
                <div>
                  <div className="font-semibold text-gray-800">{g.name}</div>
                  <div className="text-xs text-gray-500">
                    seit {fmtDate(g.created_date)} · Ziel {g.target_weight_min_kg}–{g.target_weight_max_kg} kg
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-gray-700">{g.member_count} Tiere</div>
                  <div className="text-xs text-gray-500">{g.status}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
