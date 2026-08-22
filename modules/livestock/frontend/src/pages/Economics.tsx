import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { fmtChf, num } from '../lib/format'
import type { AnimalEconomics } from '../types'

interface Row extends AnimalEconomics {
  animal_id: string
  group_name: string | null
}

async function loadEconomics(pg: PGlite): Promise<Row[]> {
  // v_animal_economics ist eine fertige View aus schema/0001_init.sql — wird
  // hier nur abgefragt, keine Neuberechnung im Frontend nötig.
  const { rows } = await pg.query<Row>(`
    select e.*, g.name as group_name
    from v_animal_economics e
    left join lateral (
      select gm.group_id from group_memberships gm
      where gm.animal_id = e.animal_id and gm.deleted_at is null
      order by gm.start_date desc limit 1
    ) cur_gm on true
    left join animal_groups g on g.id = cur_gm.group_id and g.deleted_at is null
    order by e.profit desc
  `)
  return rows
}

type SortKey = 'profit' | 'ear_tag' | 'total_revenue'

export default function Economics() {
  const { data, loading } = useQuery(loadEconomics)
  const [sortKey, setSortKey] = useState<SortKey>('profit')

  const rows = useMemo(() => {
    const list = data ?? []
    return [...list].sort((a, b) => {
      if (sortKey === 'ear_tag') return a.ear_tag.localeCompare(b.ear_tag)
      const av = num(a[sortKey]) ?? 0
      const bv = num(b[sortKey]) ?? 0
      return bv - av
    })
  }, [data, sortKey])

  const byGroup = useMemo(() => {
    const map = new Map<string, { name: string; count: number; profit: number; revenue: number; cost: number }>()
    for (const r of data ?? []) {
      const key = r.group_name ?? 'Ohne Gruppe'
      const entry = map.get(key) ?? { name: key, count: 0, profit: 0, revenue: 0, cost: 0 }
      entry.count++
      entry.profit += num(r.profit) ?? 0
      entry.revenue += num(r.total_revenue) ?? 0
      entry.cost +=
        (num(r.purchase_cost) ?? 0) + (num(r.medication_cost) ?? 0) + (num(r.allocated_group_cost) ?? 0)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => b.profit - a.profit)
  }, [data])

  if (loading && !data) return <div className="p-4 text-center text-gray-400">Lädt…</div>

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-xl font-bold text-gray-800">Wirtschaftlichkeit</h1>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-600">Nach Gruppe</h2>
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Gruppe</th>
                <th className="px-3 py-2 text-right">Tiere</th>
                <th className="px-3 py-2 text-right">Erlös</th>
                <th className="px-3 py-2 text-right">Kosten</th>
                <th className="px-3 py-2 text-right">Gewinn</th>
              </tr>
            </thead>
            <tbody>
              {byGroup.map((g) => (
                <tr key={g.name} className="border-t">
                  <td className="px-3 py-2 font-medium text-gray-800">{g.name}</td>
                  <td className="px-3 py-2 text-right">{g.count}</td>
                  <td className="px-3 py-2 text-right">{fmtChf(g.revenue)}</td>
                  <td className="px-3 py-2 text-right">{fmtChf(g.cost)}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${g.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}
                  >
                    {fmtChf(g.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600">Nach Tier</h2>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="profit">Sortiert nach Gewinn</option>
            <option value="total_revenue">Sortiert nach Erlös</option>
            <option value="ear_tag">Sortiert nach Ohrmarke</option>
          </select>
        </div>
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Ohrmarke</th>
                <th className="px-3 py-2">Gruppe</th>
                <th className="px-3 py-2 text-right">Anschaffung</th>
                <th className="px-3 py-2 text-right">Medikamente</th>
                <th className="px-3 py-2 text-right">Anteil Gruppenkosten</th>
                <th className="px-3 py-2 text-right">Erlös</th>
                <th className="px-3 py-2 text-right">Gewinn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.animal_id} className="border-t">
                  <td className="px-3 py-2">
                    <Link to={`/tiere/${r.animal_id}`} className="font-medium text-brand-700">
                      {r.ear_tag}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-500">{r.group_name ?? '–'}</td>
                  <td className="px-3 py-2 text-right">{fmtChf(r.purchase_cost)}</td>
                  <td className="px-3 py-2 text-right">{fmtChf(r.medication_cost)}</td>
                  <td className="px-3 py-2 text-right">{fmtChf(r.allocated_group_cost)}</td>
                  <td className="px-3 py-2 text-right">{fmtChf(r.total_revenue)}</td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      (num(r.profit) ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'
                    }`}
                  >
                    {fmtChf(r.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="p-3 text-center text-gray-400">Keine Daten.</p>}
      </section>
    </div>
  )
}
