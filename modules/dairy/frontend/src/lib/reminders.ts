// Erinnerungen (Pendenzen) je Tier, schema/0021: geplante Folgebehandlung oder
// Kontrolle aus dem Behandlungsformular; offen auf der Startseite «Heute».

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { upsertRow } from '../db/write'
import { isoDate } from './format'

export interface Reminder {
  id: string
  animal_id: string
  case_id: string | null
  due_date: string
  title: string
  ear_tag: string
  lauf_nr: string | null
  name: string | null
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Schnellwahl im Formular: in 1, 2, 3 oder 7 Tagen. */
export const QUICK_DAYS = [1, 2, 3, 7] as const
export const dueIn = (fromIso: string, days: number) => addDays(fromIso, days)

/** «heute», «morgen», «in 3 Tagen», «seit 2 Tagen fällig». */
export function dueText(due: string, today: string): string {
  const d = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000)
  if (d === 0) return 'heute'
  if (d === 1) return 'morgen'
  if (d > 1) return `in ${d} Tagen`
  return d === -1 ? 'seit gestern fällig' : `seit ${-d} Tagen fällig`
}

export function reminderRow(animalId: string, caseId: string | null, dueDate: string, title: string) {
  return {
    id: crypto.randomUUID(),
    animal_id: animalId,
    case_id: caseId,
    due_date: dueDate,
    title,
    done_at: null,
    done_by: null,
    created_by: getCurrentUserEmail(),
    created_at: new Date().toISOString(),
    deleted_at: null,
  }
}

export async function loadOpenReminders(pg: PGlite): Promise<Reminder[]> {
  const { rows } = await pg.query<Reminder & { due_date: unknown }>(
    `select r.id, r.animal_id, r.case_id, r.due_date, r.title, a.ear_tag, a.lauf_nr, a.name
     from reminders r join animals a on a.id = r.animal_id
     where r.deleted_at is null and r.done_at is null and a.deleted_at is null
     order by r.due_date, a.lauf_nr`,
  )
  return rows.map((r) => ({ ...r, due_date: isoDate(r.due_date)! }))
}

/** Als erledigt markieren (bleibt im Verlauf; Rückgängig über die Leiste). */
export async function completeReminder(pg: PGlite, id: string): Promise<void> {
  const { rows } = await pg.query<Record<string, unknown>>('select * from reminders where id = $1', [id])
  if (!rows[0]) return
  await upsertRow(pg, 'reminders', { ...rows[0], id, due_date: isoDate(rows[0].due_date), done_at: new Date().toISOString(), done_by: getCurrentUserEmail() } as never)
}
