// Dienstplan laden und schreiben (schema/0026); Logik in lib/duty.ts.

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail, getViewedUserEmail } from '@fmis/core/auth'
import { softDeleteRow, upsertRow, upsertRows } from '../db/write'
import { isoDate } from './format'
import { shiftId, slotsFor, timeOn, type Slot } from './duty'
import type { DutyAbsence, DutyChange, DutyPerson, DutyRequest, DutyRequestKind, DutyShift, DutySkill, DutyTemplate, DutyTemplateSlot, DutyType, DutyWeek } from '../types'
import { mondaysBetween, planWeek, templateSlotId, weekRowId, type PlanResult } from './dutyPlan'

export interface DutyData {
  people: DutyPerson[]
  types: DutyType[]
  skills: DutySkill[]
  absences: DutyAbsence[]
  shifts: DutyShift[]
  changes: DutyChange[]
  /** offene Anträge und die entschiedenen der letzten 30 Tage */
  requests: DutyRequest[]
  /** Standard-Wochenpläne (alle Versionen) und ihre Plätze */
  templates: DutyTemplate[]
  templateSlots: DutyTemplateSlot[]
  /** Status je Woche (Entwurf/bestätigt) */
  weeks: DutyWeek[]
}

const iso = (v: unknown) => isoDate(v)

/** Alles für den Zeitraum [from, to] (Dienste, Abwesenheiten, Änderungen der letzten 30 Tage). */
export async function loadDuty(pg: PGlite, from: string, to: string): Promise<DutyData> {
  const [people, types, skills, absences, shifts, changes, requests, templates, templateSlots, weeks] = await Promise.all([
    pg.query<DutyPerson>('select * from duty_people where deleted_at is null order by sort_order, name'),
    pg.query<DutyType>('select * from duty_types where deleted_at is null order by sort_order, start_time, name'),
    pg.query<DutySkill>('select * from duty_skills where deleted_at is null'),
    pg.query<DutyAbsence>('select * from duty_absences where deleted_at is null and to_date >= $1 and from_date <= $2 order by from_date', [from, to]),
    // auch die Dienste, um die es in offenen Anträgen geht (können ausserhalb des Zeitraums liegen)
    pg.query<DutyShift>(
      `select * from duty_shifts where deleted_at is null and (date between $1 and $2
         or date in (select date from duty_requests where deleted_at is null and status = 'offen' and date is not null)
         or date in (select other_date from duty_requests where deleted_at is null and status = 'offen' and other_date is not null))`,
      [from, to],
    ),
    pg.query<DutyChange>("select * from duty_changes where deleted_at is null and changed_at > now() - interval '30 days' order by changed_at desc"),
    pg.query<DutyRequest>("select * from duty_requests where deleted_at is null and (status = 'offen' or updated_at > now() - interval '30 days') order by updated_at desc"),
    pg.query<DutyTemplate>('select * from duty_templates where deleted_at is null order by valid_from desc'),
    pg.query<DutyTemplateSlot>('select * from duty_template_slots where deleted_at is null'),
    pg.query<DutyWeek>('select * from duty_weeks where deleted_at is null order by week_start'),
  ])
  return {
    people: people.rows,
    types: types.rows.map((t) => ({ ...t, duration_min: Number(t.duration_min) })),
    skills: skills.rows,
    absences: absences.rows.map((a) => ({ ...a, from_date: iso(a.from_date), to_date: iso(a.to_date) })),
    shifts: shifts.rows.map((s) => ({ ...s, date: iso(s.date), slot: Number(s.slot) })),
    changes: changes.rows.map((c) => ({ ...c, date: iso(c.date), changed_at: (c.changed_at as unknown) instanceof Date ? (c.changed_at as unknown as Date).toISOString() : String(c.changed_at) })),
    requests: requests.rows.map((r) => ({
      ...r,
      date: r.date ? iso(r.date) : null,
      other_date: r.other_date ? iso(r.other_date) : null,
      from_date: r.from_date ? iso(r.from_date) : null,
      to_date: r.to_date ? iso(r.to_date) : null,
      decided_at: r.decided_at ? ((r.decided_at as unknown) instanceof Date ? (r.decided_at as unknown as Date).toISOString() : String(r.decided_at)) : null,
    })),
    templates: templates.rows.map((t) => ({ ...t, valid_from: iso(t.valid_from), cycle_weeks: Number(t.cycle_weeks) || 1 })),
    templateSlots: templateSlots.rows.map((s) => ({ ...s, week_no: Number(s.week_no), weekday: Number(s.weekday), slot: Number(s.slot) })),
    weeks: weeks.rows.map((w) => ({ ...w, week_start: iso(w.week_start) })),
  }
}

export type ChangeKind = DutyChange['kind']

/** Platz neu besetzen (personId null = leeren) und die Änderung protokollieren. */
export async function assignSlots(
  items: { slot: Slot; personId: string | null; kind?: ChangeKind; notes?: string | null; /** Hinweis am Dienst selbst (z.B. «Ersatz für …») */ shiftNote?: string | null }[],
): Promise<void> {
  if (!items.length) return
  const me = getCurrentUserEmail()
  const now = new Date().toISOString()
  const shifts: Record<string, unknown>[] = []
  const changes: Record<string, unknown>[] = []
  for (const { slot, personId, kind, notes, shiftNote } of items) {
    const from = slot.shift?.person_id ?? null
    if (from === personId) continue
    shifts.push({
      id: slot.id,
      type_id: slot.type.id,
      date: slot.date,
      slot: slot.slot,
      person_id: personId,
      notes: shiftNote !== undefined ? shiftNote : (slot.shift?.notes ?? null),
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


// --- Freiwünsche und Vorschläge (schema/0004) -------------------------------
// Mitarbeitende stellen Anträge, das Büro entscheidet. Erst die Bestätigung
// ändert den Plan (assignSlots / saveAbsence) — der Server lässt Mitarbeitende
// nur in duty_requests schreiben (modules/betrieb/backend/app/sync.py).

type RequestInput = Pick<DutyRequest, 'kind' | 'person_id'> &
  Partial<Pick<DutyRequest, 'shift_id' | 'date' | 'type_id' | 'to_person' | 'other_shift_id' | 'other_date' | 'other_type_id' | 'from_date' | 'to_date' | 'notes'>>

const emptyRequest = (): Omit<DutyRequest, 'id' | 'kind' | 'person_id' | 'updated_at'> => ({
  shift_id: null, date: null, type_id: null, to_person: null, other_shift_id: null, other_date: null, other_type_id: null,
  from_date: null, to_date: null, notes: null, status: 'offen', decided_by: null, decided_at: null, decision_note: null,
  created_by: null, deleted_at: null,
})

export const saveRequest = (r: RequestInput) =>
  upsertRow('duty_requests', { ...emptyRequest(), ...r, id: crypto.randomUUID(), created_by: getCurrentUserEmail() } as never)

/** Eigenen offenen Antrag zurückziehen. */
export const withdrawRequest = (r: DutyRequest) =>
  upsertRow('duty_requests', { ...r, status: 'zurueckgezogen' as const } as never)

/** Platz aus Typ, Datum und fester Platz-id wiederfinden (der Platz hat evtl. noch keine Zeile in duty_shifts). */
export function slotById(types: DutyType[], shifts: DutyShift[], typeId: string | null, date: string | null, id: string | null): Slot | null {
  if (!typeId || !date || !id) return null
  const type = types.find((t) => t.id === typeId)
  if (!type) return null
  for (let i = 0; i < 20; i++) {
    if (shiftId(type.id, date, i) === id) return slotsFor([type], shifts, [date]).find((s) => s.slot === i) ?? { type: { ...type, ...timeOn(type, date) }, date, slot: i, id, shift: null }
  }
  return null
}

export interface RequestCheck {
  /** Antrag lässt sich so noch umsetzen */
  ok: boolean
  /** Sätze für die Anzeige: was gilt aktuell / warum nicht mehr */
  notes: string[]
}

/** Ist der Antrag noch umsetzbar? Der Plan kann sich seit dem Antrag geändert haben. */
export function checkRequest(d: DutyData, r: DutyRequest): RequestCheck {
  const notes: string[] = []
  if (r.kind === 'wunsch') return { ok: !!(r.from_date && r.to_date), notes }
  const mine = slotById(d.types, d.shifts, r.type_id, r.date, r.shift_id)
  if (!mine) return { ok: false, notes: ['Der Dienst ist nicht mehr vorhanden.'] }
  if (mine.shift?.person_id !== r.person_id) notes.push('Der Dienst gehört nicht mehr dieser Person.')
  if (r.kind === 'tausch') {
    const other = slotById(d.types, d.shifts, r.other_type_id, r.other_date, r.other_shift_id)
    if (!other || !r.to_person) notes.push('Der Gegen-Dienst fehlt.')
    else if (other.shift?.person_id !== r.to_person) notes.push('Der Gegen-Dienst gehört nicht mehr der Tauschperson.')
  }
  return { ok: notes.length === 0, notes }
}

/** Antrag entscheiden. Bestätigen setzt ihn im Plan um (nur wenn checkRequest ok). */
export async function decideRequest(d: DutyData, r: DutyRequest, decision: 'bestaetigt' | 'abgelehnt', note?: string): Promise<void> {
  if (decision === 'bestaetigt') {
    const check = checkRequest(d, r)
    if (!check.ok) throw new Error(check.notes.join(' ') || 'Antrag nicht mehr umsetzbar')
    if (r.kind === 'wunsch') {
      await saveAbsence({ id: crypto.randomUUID(), person_id: r.person_id, from_date: r.from_date!, to_date: r.to_date!, kind: 'frei', notes: r.notes ? `Freiwunsch: ${r.notes}` : 'Freiwunsch' })
    } else {
      const mine = slotById(d.types, d.shifts, r.type_id, r.date, r.shift_id)!
      if (r.kind === 'abgabe') {
        await assignSlots([{ slot: mine, personId: r.to_person ?? null, kind: 'abgabe', notes: r.notes }])
      } else {
        const other = slotById(d.types, d.shifts, r.other_type_id, r.other_date, r.other_shift_id)!
        await assignSlots([
          { slot: mine, personId: r.to_person, kind: 'tausch', notes: r.notes },
          { slot: other, personId: r.person_id, kind: 'tausch', notes: r.notes },
        ])
      }
    }
  }
  await upsertRow('duty_requests', {
    ...r,
    status: decision,
    decided_by: getCurrentUserEmail(),
    decided_at: new Date().toISOString(),
    decision_note: note?.trim() || null,
  } as never)
}

export type { DutyRequestKind }

// --- Standard-Wochenpläne (schema/0006) ---------------------------------------

export const saveTemplate = (t: Omit<DutyTemplate, 'updated_at' | 'deleted_at'>) => upsertRow('duty_templates', { ...t, deleted_at: null } as never)
export const deleteTemplate = (id: string) => softDeleteRow('duty_templates', id)

/** Person für einen Platz der Vorlage setzen (null = offen). */
export function setTemplateSlot(templateId: string, weekNo: number, weekday: number, typeId: string, slot: number, personId: string | null) {
  return upsertRow('duty_template_slots', {
    id: templateSlotId(templateId, weekNo, weekday, typeId, slot),
    template_id: templateId,
    week_no: weekNo,
    weekday,
    type_id: typeId,
    slot,
    person_id: personId,
    deleted_at: null,
  } as never)
}

/** Neue Version ab Datum: kopiert Plätze einer bestehenden Vorlage (die alte bleibt erhalten). */
export async function copyTemplate(d: DutyData, sourceId: string | null, name: string, validFrom: string, cycleWeeks?: number): Promise<string> {
  const src = sourceId ? d.templates.find((t) => t.id === sourceId) : null
  const id = crypto.randomUUID()
  const cycle = cycleWeeks ?? src?.cycle_weeks ?? 1
  await saveTemplate({ id, name, valid_from: validFrom, cycle_weeks: cycle, notes: null })
  const rows = d.templateSlots
    .filter((s) => src && s.template_id === src.id && s.week_no < cycle && s.person_id)
    .map((s) => ({
      id: templateSlotId(id, s.week_no, s.weekday, s.type_id, s.slot),
      template_id: id,
      week_no: s.week_no,
      weekday: s.weekday,
      type_id: s.type_id,
      slot: s.slot,
      person_id: s.person_id,
      deleted_at: null,
    }))
  await upsertRows('duty_template_slots', rows as never)
  return id
}

/** Vorlage aus einer eingeteilten Woche (eine Zykluswoche). */
export async function templateFromWeek(weekSlots: { weekday: number; type_id: string; slot: number; person_id: string }[], name: string, validFrom: string): Promise<string> {
  const id = crypto.randomUUID()
  await saveTemplate({ id, name, valid_from: validFrom, cycle_weeks: 1, notes: null })
  await upsertRows(
    'duty_template_slots',
    weekSlots.map((s) => ({ id: templateSlotId(id, 0, s.weekday, s.type_id, s.slot), template_id: id, week_no: 0, ...s, deleted_at: null })) as never,
  )
  return id
}

/** Dienste einer Woche aus der Datenbank (die Wochen können ausserhalb des geladenen Zeitraums liegen). */
async function shiftsOfWeek(pg: PGlite, monday: string): Promise<DutyShift[]> {
  const { rows } = await pg.query<DutyShift>(
    "select * from duty_shifts where deleted_at is null and date between $1::date and $1::date + 6",
    [monday],
  )
  return rows.map((s) => ({ ...s, date: iso(s.date), slot: Number(s.slot) }))
}

async function absencesOfWeek(pg: PGlite, monday: string): Promise<DutyAbsence[]> {
  const { rows } = await pg.query<DutyAbsence>(
    'select * from duty_absences where deleted_at is null and to_date >= $1::date and from_date <= $1::date + 6',
    [monday],
  )
  return rows.map((a) => ({ ...a, from_date: iso(a.from_date), to_date: iso(a.to_date) }))
}

async function applyPlan(r: PlanResult): Promise<void> {
  await assignSlots(r.assignments.map((a) => ({ slot: a.slot, personId: a.personId, kind: 'einteilen', shiftNote: a.note, notes: a.note })))
}

/** Fehlende Wochen von..bis als Entwurf aus der Vorlage erzeugen. Bestehende Wochen bleiben, wie sie sind.
 * Gibt je Woche die Plätze zurück, für die niemand frei war. */
export async function generateWeeks(pg: PGlite, d: DutyData, fromMonday: string, toMonday: string): Promise<{ created: number; unfilled: string[] }> {
  const have = new Set(d.weeks.map((w) => w.week_start))
  let created = 0
  const unfilled: string[] = []
  for (const monday of mondaysBetween(fromMonday, toMonday)) {
    if (have.has(monday)) continue
    const r = planWeek({ monday, types: d.types, templates: d.templates, templateSlots: d.templateSlots, shifts: await shiftsOfWeek(pg, monday), people: d.people, skills: d.skills, absences: await absencesOfWeek(pg, monday) })
    await applyPlan(r)
    await upsertRow('duty_weeks', { id: weekRowId(monday), week_start: monday, status: 'entwurf', generated_at: new Date().toISOString(), confirmed_by: null, confirmed_at: null, notes: null, deleted_at: null } as never)
    created++
    unfilled.push(...r.unfilled)
  }
  return { created, unfilled }
}

/** Woche an die Abwesenheiten anpassen: offene Plätze aus der Vorlage füllen, Abwesende ersetzen. */
export async function adjustWeek(pg: PGlite, d: DutyData, monday: string): Promise<{ changed: number; unfilled: string[] }> {
  const r = planWeek({ monday, types: d.types, templates: d.templates, templateSlots: d.templateSlots, shifts: await shiftsOfWeek(pg, monday), people: d.people, skills: d.skills, absences: await absencesOfWeek(pg, monday), adjustExisting: true })
  await applyPlan(r)
  return { changed: r.assignments.length, unfilled: r.unfilled }
}

/** Woche bestätigen (oder zurück auf Entwurf). */
export async function setWeekStatus(d: DutyData, monday: string, status: 'entwurf' | 'bestaetigt'): Promise<void> {
  const w = d.weeks.find((x) => x.week_start === monday)
  await upsertRow('duty_weeks', {
    id: w?.id ?? weekRowId(monday),
    week_start: monday,
    status,
    generated_at: w?.generated_at ?? null,
    confirmed_by: status === 'bestaetigt' ? getCurrentUserEmail() : null,
    confirmed_at: status === 'bestaetigt' ? new Date().toISOString() : null,
    notes: w?.notes ?? null,
    deleted_at: null,
  } as never)
}

