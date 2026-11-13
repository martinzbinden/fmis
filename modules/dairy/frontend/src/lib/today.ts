// Daten der Startseite «Heute» (pages/Today.tsx): was im Stall ansteht.

import type { PGlite } from '@electric-sql/pglite'
import { GESTATION_DAYS, type Species } from './fertility'
import { isoDate } from './format'
import { notSupersededSql } from './journal'
import { MILK_UNTIL_SQL } from './treatments'
import { loadPendingOffspring } from './earTagPending'
import { loadOpenReminders, type Reminder } from './reminders'

export interface TodayAnimal {
  id: string
  ear_tag: string
  lauf_nr: string | null
  name: string | null
}

export interface ExpectedBirth {
  animal: TodayAnimal
  /** frühester / spätester erwarteter Tag (Belegung über einen Zeitraum) */
  from: string
  to: string
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10)

/** Erwartete Geburten bis `today + days`: letzte Belegung je Tier plus
 * Tragzeit — nicht, wenn seither geboren oder zuletzt «leer» untersucht.
 * Bereits überfällige (bis 14 Tage) bleiben stehen. Rein, für Tests. */
export function expectedBirths(
  input: {
    animals: TodayAnimal[]
    matings: { animal_id: string; service_date: string; service_to: string | null }[]
    births: { dam_id: string; birth_date: string }[]
    checks: { animal_id: string; check_date: string; result: string }[]
  },
  species: Species,
  today: string,
  days = 14,
): ExpectedBirth[] {
  const g = GESTATION_DAYS[species]
  const latest = <T, K extends keyof T>(rows: T[], idKey: K, dateKey: keyof T) => {
    const m = new Map<T[K], T>()
    for (const r of rows) {
      const cur = m.get(r[idKey])
      if (!cur || String(r[dateKey]) > String(cur[dateKey])) m.set(r[idKey], r)
    }
    return m
  }
  const lastMating = latest(input.matings, 'animal_id', 'service_date')
  const lastBirth = latest(input.births, 'dam_id', 'birth_date')
  const lastCheck = latest(input.checks, 'animal_id', 'check_date')
  const until = addDays(today, days)
  const overdue = addDays(today, -14)
  const out: ExpectedBirth[] = []
  for (const a of input.animals) {
    const m = lastMating.get(a.id)
    if (!m) continue
    const b = lastBirth.get(a.id)
    if (b && b.birth_date >= m.service_date) continue
    const c = lastCheck.get(a.id)
    if (c && c.check_date >= m.service_date && c.result === 'nein') continue
    const from = addDays(m.service_date, g)
    const to = addDays(m.service_to ?? m.service_date, g)
    if (from <= until && to >= overdue) out.push({ animal: a, from, to })
  }
  return out.sort((x, y) => x.from.localeCompare(y.from))
}

export interface TodayData {
  pendingEarTags: number
  withdrawals: (TodayAnimal & { until: string })[]
  openBank: { bank_number: number; session_date: string; slots: number } | null
  expected: ExpectedBirth[]
  markedLists: { id: string; name: string; marked: number; open: number }[]
  /** offene Erinnerungen (Folgebehandlungen …), fällige zuerst */
  reminders: Reminder[]
}

/** Erwartete Geburten bis `today + days` aus der lokalen Datenbank (Belegungen, Geburten, Untersuchungen). */
export async function loadExpectedBirths(pg: PGlite, species: Species, today: string, days = 14): Promise<ExpectedBirth[]> {
  const [animals, matings, births, checks] = await Promise.all([
    pg.query<TodayAnimal>(`select id, ear_tag, lauf_nr, name from animals where deleted_at is null and status = 'aktiv' and sex = 'w'`),
    pg.query<{ animal_id: string; service_date: unknown; service_to: unknown }>('select animal_id, service_date, service_to from matings where deleted_at is null'),
    pg.query<{ dam_id: string; birth_date: unknown }>('select dam_id, birth_date from births where deleted_at is null'),
    pg.query<{ animal_id: string; check_date: unknown; result: string }>('select animal_id, check_date, result from pregnancy_checks where deleted_at is null'),
  ])
  return expectedBirths(
    {
      animals: animals.rows,
      matings: matings.rows.map((m) => ({ animal_id: m.animal_id, service_date: isoDate(m.service_date)!, service_to: isoDate(m.service_to) ?? null })),
      births: births.rows.map((b) => ({ dam_id: b.dam_id, birth_date: isoDate(b.birth_date)! })),
      checks: checks.rows.map((c) => ({ animal_id: c.animal_id, check_date: isoDate(c.check_date)!, result: c.result })),
    },
    species,
    today,
    days,
  )
}

export async function loadToday(pg: PGlite, species: Species, today: string): Promise<TodayData> {
  const [pending, withdrawals, banks, expected, lists, reminders] = await Promise.all([
    loadPendingOffspring(pg),
    pg.query<TodayAnimal & { until: unknown }>(
      `select a.id, a.ear_tag, a.lauf_nr, a.name, max(${MILK_UNTIL_SQL}) as until
       from animal_journal j join animals a on a.id = j.animal_id
       where j.deleted_at is null and a.deleted_at is null and a.status = 'aktiv' and ${notSupersededSql('j')}
       group by a.id, a.ear_tag, a.lauf_nr, a.name
       having max(${MILK_UNTIL_SQL}) >= $1::date
       order by until`,
      [today],
    ),
    pg.query<{ id: string; bank_number: number; session_date: unknown; slots: number }>(
      `select b.id, b.bank_number, b.session_date,
         (select count(*)::int from milking_slots s where s.bank_id = b.id and s.deleted_at is null) as slots
       from milking_banks b where b.deleted_at is null and b.closed_at is null
         and b.session_date >= $1::date - 1
       order by b.opened_at desc limit 1`,
      // nur von heute/gestern — eine vergessene offene Bank von früher «läuft» nicht
      [today],
    ),
    loadExpectedBirths(pg, species, today),
    pg.query<{ id: string; name: string; marked: number; open: number }>(
      `select l.id, l.name,
         count(*) filter (where e.reason is not null and e.reason <> '')::int as marked,
         count(*)::int as open
       from watchlists l join watchlist_entries e on e.list_id = l.id and e.deleted_at is null and e.done_at is null
       where l.deleted_at is null and l.archived_at is null
       group by l.id, l.name
       having count(*) filter (where e.reason is not null and e.reason <> '') > 0
       order by l.name`,
    ),
    loadOpenReminders(pg),
  ])
  const bank = banks.rows[0]
  return {
    pendingEarTags: pending.length,
    withdrawals: withdrawals.rows.map((w) => ({ ...w, until: isoDate(w.until)! })),
    openBank: bank ? { bank_number: bank.bank_number, session_date: isoDate(bank.session_date)!, slots: bank.slots } : null,
    expected,
    markedLists: lists.rows,
    reminders,
  }
}
