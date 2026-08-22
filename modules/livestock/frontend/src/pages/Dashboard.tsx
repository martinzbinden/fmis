import { Link } from 'react-router-dom'
import type { PGlite } from '@electric-sql/pglite'
import { useQuery } from '../hooks/useQuery'
import { computeForecast, type AmpelStatus } from '../lib/forecast'
import { num, fmtKg, todayIso } from '../lib/format'

interface Row {
  id: string
  ear_tag: string
  group_name: string | null
  target_weight_min_kg: number | null
  target_weight_max_kg: number | null
  last_weigh_date: string | null
  last_weight: unknown
  prev_weigh_date: string | null
  prev_weight: unknown
  withdrawal_until: string | null
}

interface Classified extends Row {
  status: AmpelStatus
  reason: string
  adgKgPerDay: number | null
  lastWeightNum: number | null
}

async function loadDashboard(pg: PGlite): Promise<Classified[]> {
  const { rows } = await pg.query<Row>(`
    select
      a.id, a.ear_tag,
      g.name as group_name,
      coalesce(g.target_weight_min_kg, 45) as target_weight_min_kg,
      coalesce(g.target_weight_max_kg, 50) as target_weight_max_kg,
      w_last.date as last_weigh_date, w_last.weight_kg as last_weight,
      w_prev.date as prev_weigh_date, w_prev.weight_kg as prev_weight,
      wd.withdrawal_until
    from animals a
    left join lateral (
      select gm.group_id
      from group_memberships gm
      where gm.animal_id = a.id and gm.deleted_at is null and gm.end_date is null
      order by gm.start_date desc limit 1
    ) cur_gm on true
    left join animal_groups g on g.id = cur_gm.group_id and g.deleted_at is null
    left join lateral (
      select id, date, weight_kg from weighings w
      where w.animal_id = a.id and w.deleted_at is null
      order by w.date desc, w.updated_at desc limit 1
    ) w_last on true
    left join lateral (
      select date, weight_kg from weighings w
      where w.animal_id = a.id and w.deleted_at is null and w.id <> w_last.id
      order by w.date desc, w.updated_at desc limit 1
    ) w_prev on true
    left join lateral (
      select max(m.date + m.withdrawal_days) as withdrawal_until
      from medications m
      where m.animal_id = a.id and m.deleted_at is null
    ) wd on true
    where a.deleted_at is null and a.status = 'aktiv'
    order by a.ear_tag
  `)

  const today = todayIso()
  return rows.map((r) => {
    const forecast = computeForecast({
      lastWeighDate: r.last_weigh_date,
      lastWeight: num(r.last_weight),
      prevWeighDate: r.prev_weigh_date,
      prevWeight: num(r.prev_weight),
      targetMinKg: num(r.target_weight_min_kg) ?? 45,
      targetMaxKg: num(r.target_weight_max_kg) ?? 50,
      withdrawalUntil: r.withdrawal_until,
      today,
    })
    return {
      ...r,
      status: forecast.status,
      reason: forecast.reason,
      adgKgPerDay: forecast.adgKgPerDay,
      lastWeightNum: num(r.last_weight),
    }
  })
}

const STATUS_META: Record<AmpelStatus, { label: string; color: string; dot: string }> = {
  bald_schlachtreif: { label: 'Bald schlachtreif', color: 'border-green-200 bg-green-50', dot: 'bg-green-500' },
  im_plan: { label: 'Im Plan', color: 'border-blue-200 bg-blue-50', dot: 'bg-blue-500' },
  achtung: { label: 'Achtung', color: 'border-red-200 bg-red-50', dot: 'bg-red-500' },
}

export default function Dashboard() {
  const { data, loading } = useQuery(loadDashboard)

  if (loading && !data) {
    return <div className="p-4 text-center text-gray-400">Lädt…</div>
  }

  const animals = data ?? []
  if (animals.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">Noch keine aktiven Tiere erfasst.</p>
        <Link to="/tiere" className="mt-3 inline-block text-brand-700 underline">
          Tiere verwalten
        </Link>
      </div>
    )
  }

  const groups: Record<AmpelStatus, Classified[]> = {
    achtung: animals.filter((a) => a.status === 'achtung'),
    bald_schlachtreif: animals.filter((a) => a.status === 'bald_schlachtreif'),
    im_plan: animals.filter((a) => a.status === 'im_plan'),
  }

  const order: AmpelStatus[] = ['achtung', 'bald_schlachtreif', 'im_plan']

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-xl font-bold text-gray-800">Dashboard</h1>
      <div className="grid grid-cols-3 gap-2 text-center">
        {order.map((s) => (
          <div key={s} className={`rounded-lg border p-3 ${STATUS_META[s].color}`}>
            <div className="text-2xl font-bold text-gray-800">{groups[s].length}</div>
            <div className="text-xs text-gray-600">{STATUS_META[s].label}</div>
          </div>
        ))}
      </div>

      {order.map((s) => (
        <section key={s}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-600">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_META[s].dot}`} />
            {STATUS_META[s].label} ({groups[s].length})
          </h2>
          {groups[s].length === 0 ? (
            <p className="text-sm text-gray-400">Keine Tiere</p>
          ) : (
            <ul className="space-y-2">
              {groups[s].map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/tiere/${a.id}`}
                    className={`flex items-center justify-between rounded-lg border p-3 shadow-sm active:opacity-80 ${STATUS_META[s].color}`}
                  >
                    <div>
                      <div className="font-semibold text-gray-800">{a.ear_tag}</div>
                      <div className="text-xs text-gray-600">{a.reason}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm text-gray-800">{fmtKg(a.lastWeightNum)}</div>
                      {a.group_name && <div className="text-xs text-gray-500">{a.group_name}</div>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
