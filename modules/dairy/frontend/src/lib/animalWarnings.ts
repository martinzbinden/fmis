// Warnungen bei der Erfassung (Belegung, Trächtigkeit, Geburt), abhängig vom Zusammenhang.
// Beispiel: ein als trächtig gemeldetes Tier wird belegt → Fehldiagnose oder Abort, kann
// Grund für die Ausmerzung sein. Eine Warnung lässt sich ignorieren oder das Tier auf eine
// Merkliste setzen (components/AnimalWarnings.tsx, lib/watchlists.ts).

import type { PGlite } from '@electric-sql/pglite'
import { GESTATION_DAYS, type Species } from './fertility'
import { fmtDate, isoDate } from './format'
import { METHOD_LABEL } from './pregnancy'
import type { PregnancyMethod, PregnancyResult } from '../types'

export interface CheckEvent {
  id: string
  check_date: string
  result: PregnancyResult
  method: PregnancyMethod | null
  examiner: string | null
  round_id: string | null
}
export interface BirthEvent {
  birth_date: string
  litter: number
  alive: number
}
export interface MatingEvent {
  service_date: string
  service_to: string | null
  sire: string | null
}
export interface ListMembership {
  entryId: string
  listId: string
  name: string
  reason: string | null
}

export interface AnimalEvents {
  /** neueste zuerst */
  checks: CheckEvent[]
  births: BirthEvent[]
  matings: MatingEvent[]
  lists: ListMembership[]
}

const EMPTY: AnimalEvents = { checks: [], births: [], matings: [], lists: [] }
export const eventsOf = (m: Map<string, AnimalEvents>, id: string): AnimalEvents => m.get(id) ?? EMPTY

/** Ereignisse aller Tiere in vier Abfragen (für Warnungen und Tier-Info). */
export async function loadAnimalEvents(pg: PGlite): Promise<Map<string, AnimalEvents>> {
  const [checks, births, matings, lists] = await Promise.all([
    pg.query<Record<string, unknown>>(
      'select id, animal_id, check_date, result, method, examiner, round_id from pregnancy_checks where deleted_at is null order by check_date desc, recorded_at desc',
    ),
    pg.query<Record<string, unknown>>(
      `select b.dam_id, b.birth_date, count(o.id) as litter,
              count(o.id) filter (where not coalesce(o.stillborn, false) and not coalesce(o.died_24h, false)) as alive
       from births b left join birth_offspring o on o.birth_id = b.id and o.deleted_at is null
       where b.deleted_at is null group by b.id, b.dam_id, b.birth_date order by b.birth_date desc`,
    ),
    pg.query<Record<string, unknown>>(
      'select animal_id, service_date, service_to, sire_name, sire_ear_tag from matings where deleted_at is null order by service_date desc',
    ),
    pg.query<Record<string, unknown>>(
      `select e.id, e.animal_id, e.list_id, e.reason, l.name from watchlist_entries e join watchlists l on l.id = e.list_id
       where e.deleted_at is null and e.done_at is null and l.deleted_at is null and l.archived_at is null order by l.name`,
    ),
  ])
  const out = new Map<string, AnimalEvents>()
  const get = (id: unknown) => {
    const k = String(id)
    let e = out.get(k)
    if (!e) out.set(k, (e = { checks: [], births: [], matings: [], lists: [] }))
    return e
  }
  for (const c of checks.rows)
    get(c.animal_id).checks.push({
      id: String(c.id),
      check_date: isoDate(c.check_date)!,
      result: c.result as PregnancyResult,
      method: (c.method as PregnancyMethod | null) ?? null,
      examiner: (c.examiner as string | null) ?? null,
      round_id: (c.round_id as string | null) ?? null,
    })
  for (const b of births.rows) get(b.dam_id).births.push({ birth_date: isoDate(b.birth_date)!, litter: Number(b.litter), alive: Number(b.alive) })
  for (const m of matings.rows)
    get(m.animal_id).matings.push({
      service_date: isoDate(m.service_date)!,
      service_to: isoDate(m.service_to),
      sire: (m.sire_name as string | null) ?? (m.sire_ear_tag as string | null) ?? null,
    })
  for (const l of lists.rows) get(l.animal_id).lists.push({ entryId: String(l.id), listId: String(l.list_id), name: String(l.name), reason: (l.reason as string | null) ?? null })
  return out
}

export type WarningContext =
  | { kind: 'mating'; date: string }
  | { kind: 'pregnancy'; date: string; result?: PregnancyResult; roundId?: string | null }
  | { kind: 'birth'; date: string }

export interface AnimalWarning {
  /** stabil je Tier und Regel (zum Ignorieren) */
  id: string
  tone: 'warn' | 'info'
  text: string
  /** vorgeschlagene Merkliste, z.B. «Ausmerzen prüfen» */
  suggestList?: string
  /** in Listen-Erfassungen: Entfernen aus der neuen Liste empfehlen */
  suggestRemove?: boolean
}

export const CULL_LIST = 'Ausmerzen prüfen'
export const RECENT_PREGNANT_DAYS = 7

const DAY = 86_400_000
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
const how = (c: CheckEvent) => [c.method ? METHOD_LABEL[c.method] : null, c.examiner].filter(Boolean).join(', ')

/** Trächtigkeitsmeldungen seit der letzten Geburt vor `date` (neueste zuerst). */
function checksSinceBirth(ev: AnimalEvents, date: string, excludeRound?: string | null): CheckEvent[] {
  const lastBirth = ev.births.find((b) => b.birth_date <= date)?.birth_date ?? null
  return ev.checks.filter((c) => c.check_date <= date && (!lastBirth || c.check_date > lastBirth) && (!excludeRound || c.round_id !== excludeRound))
}

export function animalWarnings(animalId: string, ev: AnimalEvents, ctx: WarningContext, species: Species): AnimalWarning[] {
  const out: AnimalWarning[] = []
  const id = (rule: string) => `${animalId}:${ctx.kind}:${rule}`
  const birthWord = species === 'sheep' ? 'Ablammung' : 'Abkalbung'
  const lastBirth = ev.births.find((b) => b.birth_date <= ctx.date)
  const sinceBirth = lastBirth ? days(lastBirth.birth_date, ctx.date) : null

  if (ctx.kind === 'mating') {
    const pregnant = checksSinceBirth(ev, ctx.date)[0]
    if (pregnant?.result === 'ja') {
      out.push({
        id: id('pregnant'),
        tone: 'warn',
        text: `Als trächtig gemeldet am ${fmtDate(pregnant.check_date)}${how(pregnant) ? ` (${how(pregnant)})` : ''} – Belegung widerspricht: Fehldiagnose oder Abort? Kann Grund für die Ausmerzung sein.`,
        suggestList: CULL_LIST,
      })
    }
    const services = ev.matings.filter((m) => m.service_date < ctx.date && (!lastBirth || m.service_date > lastBirth.birth_date)).length
    if (services >= 2) {
      out.push({ id: id('repeat'), tone: 'warn', text: `Seit der letzten ${birthWord} schon ${services}× belegt – wiederholt umgebockt.`, suggestList: CULL_LIST })
    }
    if (sinceBirth != null && sinceBirth < 40) out.push({ id: id('early'), tone: 'info', text: `${birthWord} erst vor ${sinceBirth} Tagen.` })
  }

  if (ctx.kind === 'pregnancy') {
    const earlier = checksSinceBirth(ev, ctx.date, ctx.roundId)
    const recent = earlier.find((c) => c.result === 'ja' && days(c.check_date, ctx.date) <= RECENT_PREGNANT_DAYS)
    if (recent) {
      const d = days(recent.check_date, ctx.date)
      out.push({
        id: id('recent'),
        tone: 'warn',
        text: `${d === 0 ? 'Heute' : `Vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`} schon trächtig gemeldet${how(recent) ? ` (${how(recent)})` : ''}.`,
        suggestRemove: true,
      })
    }
    const wasPregnant = earlier.find((c) => c.result === 'ja')
    if (ctx.result === 'nein' && wasPregnant) {
      out.push({
        id: id('lost'),
        tone: 'warn',
        text: `War am ${fmtDate(wasPregnant.check_date)} trächtig gemeldet${how(wasPregnant) ? ` (${how(wasPregnant)})` : ''} – jetzt leer: Abort oder Fehldiagnose? Kann Grund für die Ausmerzung sein.`,
        suggestList: CULL_LIST,
      })
    }
    if (sinceBirth != null && sinceBirth < 30) out.push({ id: id('early'), tone: 'info', text: `${birthWord} erst vor ${sinceBirth} Tagen.` })
  }

  if (ctx.kind === 'birth') {
    const latest = checksSinceBirth(ev, ctx.date)[0]
    if (latest?.result === 'nein' && days(latest.check_date, ctx.date) < GESTATION_DAYS[species]) {
      out.push({
        id: id('empty'),
        tone: 'info',
        text: `Zuletzt leer gemeldet am ${fmtDate(latest.check_date)}${how(latest) ? ` (${how(latest)})` : ''} – Fehldiagnose.`,
      })
    }
    const prev = ev.births.find((b) => b.birth_date < ctx.date)
    if (prev && days(prev.birth_date, ctx.date) < GESTATION_DAYS[species] - 20) {
      out.push({ id: id('interval'), tone: 'warn', text: `Letzte ${birthWord} erst am ${fmtDate(prev.birth_date)} – Datum oder Tier prüfen.` })
    }
  }

  for (const l of ev.lists) out.push({ id: `${animalId}:list:${l.listId}`, tone: 'info', text: `Auf Merkliste «${l.name}»${l.reason ? `: ${l.reason}` : ''}` })
  return out
}
