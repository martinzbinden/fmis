// Jahresübersicht (core/frontend/src/yearSummary.ts): Wartung und GPS-Fahrten.
import { fmtNum, ranking, type YearSection } from '@fmis/core/yearSummary'
import { getSyncedDb } from '../db/access'

export async function betriebYearSummary(year: number): Promise<YearSection | null> {
  const pg = await getSyncedDb()
  const from = `${year}-01-01`
  const to = `${year + 1}-01-01`
  const { rows: log } = await pg.query<{ cost: number | null }>(
    `select cost_chf::float8 as cost from maintenance_log where deleted_at is null and done_date >= $1 and done_date < $2`,
    [from, to],
  )
  const { rows: tracks } = await pg.query<{ work: string | null; hours: number | null }>(
    `select coalesce(nullif(work_type, ''), label) as work, extract(epoch from (ended_at - started_at)) / 3600 as hours
     from tracks where deleted_at is null and started_at >= $1 and started_at < $2`,
    [from, to],
  )
  if (log.length === 0 && tracks.length === 0) return null
  const cost = log.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const hoursBy = new Map<string, number>()
  for (const t of tracks) hoursBy.set(t.work ?? 'ohne Angabe', (hoursBy.get(t.work ?? 'ohne Angabe') ?? 0) + Math.max(0, Number(t.hours ?? 0)))
  const hours = [...hoursBy.values()].reduce((s, v) => s + v, 0)
  return {
    title: 'Maschinen',
    icon: '🚜',
    to: '/betrieb/wartung',
    figures: [
      { label: 'Wartungen', value: fmtNum(log.length), detail: 'Einträge im Wartungsjournal' },
      { label: 'Wartungskosten', value: `${fmtNum(cost)} Fr.`, detail: 'soweit erfasst' },
      { label: 'GPS-Fahrten', value: fmtNum(tracks.length), detail: `${fmtNum(hours, 1)} Stunden` },
    ],
    charts: tracks.length ? [{ title: 'Stunden je Arbeit (GPS)', unit: 'h', kind: 'ranking', data: ranking(hoursBy, 8) }] : [],
  }
}
