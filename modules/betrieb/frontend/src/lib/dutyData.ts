// Dienstplan laden und schreiben (schema/0026); Logik in lib/duty.ts.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail, getViewedUserEmail } from '@fmis/core/auth'
import { softDeleteRow, upsertRow, upsertRows } from '../db/write'
import { isoDate } from './format'
import type { Slot } from './duty'
import type { DutyAbsence, DutyChange, DutyPerson, DutyShift, DutySkill, DutyType } from '../types'

export interface DutyData {
  people: DutyPerson[]
  types: DutyType[]
  skills: DutySkill[]
  absences: DutyAbsence[]
  shifts: DutyShift[]
  changes: DutyChange[]
}

const iso = (v: unknown) => isoDate(v)

/** Alles für den Zeitraum [from, to] (Dienste, Abwesenheiten, Änderungen der letzten 30 Tage). */
export async function loadDuty(pg: PGlite, from: string, to: string): Promise<DutyData> {
  const [people, types, skills, absences, shifts, changes] = await Promise.all([
    pg.query<DutyPerson>('select * from duty_people where deleted_at is null order by sort_order, name'),
    pg.query<DutyType>('select * from duty_types where deleted_at is null order by sort_order, start_time, name'),
    pg.query<DutySkill>('select * from duty_skills where deleted_at is null'),
    pg.query<DutyAbsence>('select * from duty_absences where deleted_at is null and to_date >= $1 and from_date <= $2 order by from_date', [from, to]),
    pg.query<DutyShift>('select * from duty_shifts where deleted_at is null and date between $1 and $2', [from, to]),
    pg.query<DutyChange>("select * from duty_changes where deleted_at is null and changed_at > now() - interval '30 days' order by changed_at desc"),
  ])
  return {
    people: people.rows,
    types: types.rows.map((t) => ({ ...t, duration_min: Number(t.duration_min) })),
    skills: skills.rows,
    absences: absences.rows.map((a) => ({ ...a, from_date: iso(a.from_date), to_date: iso(a.to_date) })),
    shifts: shifts.rows.map((s) => ({ ...s, date: iso(s.date), slot: Number(s.slot) })),
    changes: changes.rows.map((c) => ({ ...c, date: iso(c.date), changed_at: (c.changed_at as unknown) instanceof Date ? (c.changed_at as unknown as Date).toISOString() : String(c.changed_at) })),
  }
}

export type ChangeKind = DutyChange['kind']

/** Platz neu besetzen (personId null = leeren) und die Änderung protokollieren. */
export async function assignSlots(items: { slot: Slot; personId: string | null; kind?: ChangeKind; notes?: string | null }[]): Promise<void> {
  if (!items.length) return
  const me = getCurrentUserEmail()
  const now = new Date().toISOString()
  const shifts: Record<string, unknown>[] = []
  const changes: Record<string, unknown>[] = []
  for (const { slot, personId, kind, notes } of items) {
    const from = slot.shift?.person_id ?? null
    if (from === personId) continue
    shifts.push({
      id: slot.id,
      type_id: slot.type.id,
      date: slot.date,
      slot: slot.slot,
      person_id: personId,
      notes: slot.shift?.notes ?? null,
      assigned_by: me,
      deleted_at: personId ? null : now,
    })
    // Protokoll nur für Änderungen an besetzten Diensten (Tausch, Abgabe,
    // Entfernen) — Ersteinteilungen wären nur Rauschen
    if (from) changes.push({
      id: crypto.randomUUID(),
      shift_id: slot.id,
      date: slot.date,
      type_id: slot.type.id,
      from_person: from,
      to_person: personId,
      kind: kind ?? (personId ? (from ? 'tausch' : 'einteilen') : 'entfernt'),
      changed_by: me,
      changed_at: now,
      notes: notes ?? null,
      deleted_at: null,
    })
  }
  await upsertRows('duty_shifts', shifts as never)
  await upsertRows('duty_changes', changes as never)
}

export const savePerson = (p: Omit<DutyPerson, 'updated_at' | 'deleted_at'>) => upsertRow('duty_people', { ...p, deleted_at: null } as never)
export const deletePerson = (id: string) => softDeleteRow('duty_people', id)
export const saveType = (t: Omit<DutyType, 'updated_at' | 'deleted_at'>) => upsertRow('duty_types', { ...t, deleted_at: null } as never)
export const deleteType = (id: string) => softDeleteRow('duty_types', id)

export async function setSkill(skills: DutySkill[], personId: string, typeId: string, on: boolean): Promise<void> {
  const existing = skills.find((s) => s.person_id === personId && s.type_id === typeId)
  if (on && !existing) await upsertRow('duty_skills', { id: crypto.randomUUID(), person_id: personId, type_id: typeId, deleted_at: null } as never)
  if (!on && existing) await softDeleteRow('duty_skills', existing.id)
}

export const saveAbsence = (a: Omit<DutyAbsence, 'updated_at' | 'deleted_at' | 'created_by'> & { created_by?: string | null }) =>
  upsertRow('duty_absences', { ...a, created_by: a.created_by ?? getCurrentUserEmail(), deleted_at: null } as never)
export const deleteAbsence = (id: string) => softDeleteRow('duty_absences', id)

/** Person zum angemeldeten Konto (über die E-Mail). */
export function me(people: DutyPerson[]): DutyPerson | null {
  const email = (getViewedUserEmail() ?? '').toLowerCase()
  return people.find((p) => p.email && p.email.toLowerCase() === email) ?? null
}
