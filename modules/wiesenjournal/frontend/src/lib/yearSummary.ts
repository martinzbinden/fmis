// Jahresübersicht (core/frontend/src/yearSummary.ts): Schnitte, Weide und Düngung.
import { byMonth, fmtNum, ranking, type YearSection } from '@fmis/core/yearSummary'
import { getSyncedDb } from '../db/access'

const CUTS = ['eingrasen', 'silage', 'duerrfutter_bel', 'duerrfutter_unbel']

export async function wiesenjournalYearSummary(year: number): Promise<YearSection | null> {
  const pg = await getSyncedDb()
  const from = `${year}-01-01`
  const to = `${year + 1}-01-01`
  const { rows: usage } = await pg.query<{ date: string; usage_type: string }>(
    `select to_char(entry_date, 'YYYY-MM-DD') as date, usage_type from usage_entries
     where deleted_at is null and not coalesce(is_planned, false) and entry_date >= $1 and entry_date < $2`,
    [from, to],
  )
  const { rows: fert } = await pg.query<{ date: string; name: string; n_kg: number | null }>(
    `select to_char(e.entry_date, 'YYYY-MM-DD') as date, coalesce(t.name, e.duengung_code) as name, e.n_kg::float8 as n_kg
     from fertilization_entries e left join fertilizer_types t on t.id = e.fertilizer_type_id
     where e.deleted_at is null and not coalesce(e.is_planned, false) and e.entry_date >= $1 and e.entry_date < $2`,
    [from, to],
  )
  if (usage.length === 0 && fert.length === 0) return null
  const cuts = usage.filter((u) => CUTS.includes(u.usage_type))
  const grazing = usage.filter((u) => u.usage_type === 'weide')
  const nByType = new Map<string, number>()
  for (const f of fert) nByType.set(f.name, (nByType.get(f.name) ?? 0) + Number(f.n_kg ?? 0))
  const nTotal = [...nByType.values()].reduce((s, v) => s + v, 0)
  return {
    title: 'Wiesenjournal',
    icon: '🌾',
    to: '/wiesenjournal',
    figures: [
      { label: 'Schnitte', value: fmtNum(cuts.length), detail: 'Einträge eingrasen, Silage, Dürrfutter' },
      { label: 'Weide', value: fmtNum(grazing.length), detail: 'Einträge' },
      { label: 'Düngergaben', value: fmtNum(fert.length) },
      { label: 'Stickstoff', value: `${fmtNum(nTotal)} kg N`, detail: 'aus erfassten Düngerarten' },
    ],
    charts: [
      { title: 'Schnitte je Monat', unit: 'Einträge', kind: 'months', data: byMonth(cuts) },
      { title: 'Stickstoff je Düngerart', unit: 'kg N', kind: 'ranking', data: ranking(nByType, 8) },
    ],
  }
}
