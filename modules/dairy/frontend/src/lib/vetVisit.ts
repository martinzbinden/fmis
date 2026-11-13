// Tierarztbesuch (pages/Stall.tsx, Fokus «Tierarzt»): welche Tiere untersucht werden sollten und
// was heute schon abgegeben wurde. Die Auswertung ist rein (testbar), das Laden steht darunter.

import type { PGlite } from '@electric-sql/pglite'
import { shortEarTag } from '@fmis/core/earTag'
import { daysBetween, isoDate } from './format'
import { notSupersededSql } from './journal'
import type { TodayAnimal } from './today'
import type { StallRules } from './stallRules'

export interface PendingCheck {
  animal: TodayAnimal
  /** letzte Belegung (bei Zeitraum: Ende) */
  serviceDate: string
  daysSince: number
  /** frühere Untersuchung seit der Belegung mit «unsicher» */
  unsure: boolean
}

/** Tiere, die belegt wurden, seither nicht geboren haben und noch kein Ergebnis «ja» oder «leer» haben;
 * ab `rules.kontrolleFromDays` Tagen nach der Belegung. Längst Überfälliges zuerst. */
export function pendingChecks(
  input: {
    animals: TodayAnimal[]
    matings: { animal_id: string; service_date: string; service_to: string | null }[]
    births: { dam_id: string; birth_date: string }[]
    checks: { animal_id: string; check_date: string; result: string }[]
  },
  rules: StallRules,
  today: string,
): PendingCheck[] {
  if (rules.kontrolleFromDays <= 0) return []
  const lastService = new Map<string, string>()
  for (const m of input.matings) {
    const d = m.service_to ?? m.service_date
    if (d > (lastService.get(m.animal_id) ?? '')) lastService.set(m.animal_id, d)
  }
  const out: PendingCheck[] = []
  for (const a of input.animals) {
    const service = lastService.get(a.id)
    if (!service) continue
    if (input.births.some((b) => b.dam_id === a.id && b.birth_date >= service)) continue
    const since = input.checks.filter((c) => c.animal_id === a.id && c.check_date >= service)
    if (since.some((c) => c.result === 'ja' || c.result === 'nein')) continue
    const daysSince = daysBetween(service, today)
    if (daysSince < rules.kontrolleFromDays) continue
    out.push({ animal: a, serviceDate: service, daysSince, unsure: since.length > 0 })
  }
  return out.sort((x, y) => y.daysSince - x.daysSince)
}

export interface GivenToday {
  id: string
  animal_id: string | null
  who: string
  what: string
}

export interface VetData {
  pending: PendingCheck[]
  given: GivenToday[]
}

export async function loadVet(pg: PGlite, today: string, rules: StallRules): Promise<VetData> {
  const [animals, matings, births, checks, given] = await Promise.all([
    pg.query<TodayAnimal>(`select id, ear_tag, lauf_nr, name from animals where deleted_at is null and status = 'aktiv' and sex = 'w'`),
    pg.query<{ animal_id: string; service_date: unknown; service_to: unknown }>('select animal_id, service_date, service_to from matings where deleted_at is null'),
    pg.query<{ dam_id: string; birth_date: unknown }>('select dam_id, birth_date from births where deleted_at is null'),
    pg.query<{ animal_id: string; check_date: unknown; result: string }>('select animal_id, check_date, result from pregnancy_checks where deleted_at is null'),
    pg.query<{ id: string; animal_id: string | null; lauf_nr: string | null; ear_tag: string | null; animal_ear_tag: string | null; medication: string | null; diagnosis: string | null; text: string | null }>(
      `select j.id, j.animal_id, a.lauf_nr, a.ear_tag, j.ear_tag as animal_ear_tag, j.medication, j.diagnosis, j.text
       from animal_journal j left join animals a on a.id = j.animal_id
       where j.deleted_at is null and j.category = 'behandlung' and j.entry_date = $1::date and ${notSupersededSql('j')}
       order by j.updated_at desc`,
      [today],
    ),
  ])
  return {
    pending: pendingChecks(
      {
        animals: animals.rows,
        matings: matings.rows.map((m) => ({ animal_id: m.animal_id, service_date: isoDate(m.service_date)!, service_to: isoDate(m.service_to) ?? null })),
        births: births.rows.map((b) => ({ dam_id: b.dam_id, birth_date: isoDate(b.birth_date)! })),
        checks: checks.rows.map((c) => ({ animal_id: c.animal_id, check_date: isoDate(c.check_date)!, result: c.result })),
      },
      rules,
      today,
    ),
    given: given.rows.map((g) => ({
      id: g.id,
      animal_id: g.animal_id,
      who: `${g.lauf_nr ? `${g.lauf_nr} · ` : ''}${shortEarTag(g.ear_tag ?? g.animal_ear_tag ?? '?')}`,
      what: [g.medication, g.diagnosis ?? g.text].filter(Boolean).join(' · ') || 'Behandlung',
    })),
  }
}
