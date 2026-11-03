// Jahresübersicht (core/frontend/src/yearSummary.ts): Bestand, Geburten, Abgänge, Behandlungen.
import { byMonth, fmtNum, type YearSection } from '@fmis/core/yearSummary'
import { getDb } from '../db/pglite'
import { speciesTerms } from './species'

export async function dairyYearSummary(moduleKey: string, title: string, year: number): Promise<YearSection | null> {
  const pg = await getDb(moduleKey)
  const terms = speciesTerms(moduleKey)
  const from = `${year}-01-01`
  const to = `${year + 1}-01-01`
  // Stichtag: Jahresende, im laufenden Jahr heute
  const today = new Date().toISOString().slice(0, 10)
  const cutoff = to <= today ? `${year}-12-31` : today
  const { rows: stock } = await pg.query<{ sex: string | null; n: number }>(
    `select sex, count(*)::int as n from animals
     where deleted_at is null
       and coalesce(entry_date, birth_date, $1::date) <= $1::date
       and (exit_date is null or exit_date > $1::date)
       and not (status = 'abgegangen' and exit_date is null)
     group by sex`,
    [cutoff],
  )
  const { rows: born } = await pg.query<{ date: string; sex: string | null }>(
    `select to_char(birth_date, 'YYYY-MM-DD') as date, sex from animals where deleted_at is null and birth_date >= $1 and birth_date < $2`,
    [from, to],
  )
  const { rows: gone } = await pg.query<{ date: string }>(
    `select to_char(exit_date, 'YYYY-MM-DD') as date from animals where deleted_at is null and exit_date >= $1 and exit_date < $2`,
    [from, to],
  )
  const { rows: births } = await pg.query<{ n: number }>(
    `select count(*)::int as n from births where deleted_at is null and birth_date >= $1 and birth_date < $2`,
    [from, to],
  )
  const { rows: treat } = await pg.query<{ n: number }>(
    `select count(*)::int as n from animal_journal where deleted_at is null and category = 'behandlung' and entry_date >= $1 and entry_date < $2`,
    [from, to],
  )
  const total = stock.reduce((s, r) => s + r.n, 0)
  if (total === 0 && born.length === 0 && gone.length === 0) return null
  const female = stock.find((r) => r.sex === 'w')?.n ?? 0
  const male = stock.find((r) => r.sex === 'm')?.n ?? 0
  const bornF = born.filter((b) => b.sex === 'w').length
  return {
    title,
    icon: moduleKey === 'dairy_schafe' ? '🐑' : '🐄',
    to: `/${moduleKey}/tiere`,
    figures: [
      { label: cutoff === today ? 'Bestand heute' : 'Bestand 31.12.', value: fmtNum(total), detail: `${female} weiblich · ${male} männlich` },
      { label: 'Geboren', value: fmtNum(born.length), detail: `${bornF} weiblich · ${born.length - bornF} männlich` },
      { label: 'Abgegangen', value: fmtNum(gone.length), detail: 'verkauft, geschlachtet, verendet' },
      { label: `${terms.calving}en`, value: fmtNum(births[0]?.n ?? 0), detail: 'erfasst' },
      { label: 'Behandlungen', value: fmtNum(treat[0]?.n ?? 0), detail: 'im Journal' },
    ],
    charts: [
      { title: 'Geborene Tiere je Monat', unit: 'Tiere', kind: 'months', data: byMonth(born) },
      { title: 'Abgänge je Monat', unit: 'Tiere', kind: 'months', data: byMonth(gone) },
    ],
  }
}
