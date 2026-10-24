// Standard-Wochenpläne: welche Vorlage an einem Datum gilt, Wochen daraus
// erzeugen (Abwesenheiten berücksichtigt) und Bestätigungsfrist — reine
// Funktionen (getestet). Schreiben: lib/dutyData.ts.

import { absenceOn, addDays, conflictsFor, hasConflict, mondayOf, shiftId, slotsFor, weekdayIndex, weekDates, type Slot } from './duty'
import type { DutyAbsence, DutyPerson, DutyShift, DutySkill, DutyTemplate, DutyTemplateSlot, DutyType, DutyWeek } from '../types'

/** Wochen müssen spätestens so viele Monate im Voraus vom Büro bestätigt sein. */
export const CONFIRM_MONTHS = 2
/** So weit im Voraus werden Wochen als Entwurf erzeugt (Monate Frist + gut ein Monat Zeit zum Prüfen). */
export const GENERATE_AHEAD_WEEKS = 16

/** Kalendermonate addieren (31.12. + 2 Monate → 28./29.2. klemmt auf den letzten Tag). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1, 12))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate()
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Feste id der Woche (gleiche Woche = gleiche Zeile auf jedem Gerät). */
export const weekRowId = (monday: string) => shiftId('week', monday, 0)
/** Feste id eines Vorlage-Platzes. */
export const templateSlotId = (templateId: string, weekNo: number, weekday: number, typeId: string, slot: number) =>
  shiftId(`tpl|${templateId}|${weekNo}|${typeId}`, `w${weekday}`, slot)

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/** Die Vorlage, die an diesem Datum gilt: die mit dem jüngsten «gültig ab» bis einschliesslich dieses Tages. */
export function templateOn(templates: DutyTemplate[], iso: string): DutyTemplate | null {
  let best: DutyTemplate | null = null
  for (const t of templates) {
    if (t.deleted_at || t.valid_from > iso) continue
    if (!best || t.valid_from > best.valid_from) best = t
  }
  return best
}

/** Welche Woche des Zyklus (0-basiert) an diesem Datum gilt; ab der Woche von «gültig ab» gezählt. */
export function weekNoOn(t: Pick<DutyTemplate, 'valid_from' | 'cycle_weeks'>, iso: string): number {
  if (t.cycle_weeks <= 1) return 0
  const weeks = Math.floor(daysBetween(mondayOf(t.valid_from), mondayOf(iso)) / 7)
  return ((weeks % t.cycle_weeks) + t.cycle_weeks) % t.cycle_weeks
}

export interface PlannedAssignment {
  slot: Slot
  personId: string
  /** Hinweis am Dienst, z.B. «Ersatz für Anna (Ferien)»; null = so wie in der Vorlage */
  note: string | null
}
export interface PlanResult {
  assignments: PlannedAssignment[]
  /** Plätze, für die niemand frei ist (bleiben offen): Text für die Anzeige */
  unfilled: string[]
}

export interface PlanInput {
  monday: string
  types: DutyType[]
  templates: DutyTemplate[]
  templateSlots: DutyTemplateSlot[]
  /** bereits vorhandene Dienste dieser Woche */
  shifts: DutyShift[]
  people: DutyPerson[]
  skills: DutySkill[]
  absences: DutyAbsence[]
  /** true: schon eingeteilte Personen, die abwesend sind, durch Ersatz ersetzen (statt nur offene Plätze zu füllen) */
  adjustExisting?: boolean
}

const ABSENCE_LABEL: Record<string, string> = { ferien: 'Ferien', frei: 'frei', krank: 'krank', kurs: 'Kurs', andere: 'abwesend' }

/** Eine Woche aus der Vorlage einteilen. Schon eingeteilte Plätze bleiben unberührt (ausser mit
 * adjustExisting bei Abwesenheit). Ist die Vorlagenperson abwesend, gleichzeitig eingeteilt oder nicht
 * (mehr) befähigt, springt die Person mit der geringsten Auslastung ein (wie «Offene vorschlagen»);
 * der Hinweis am Dienst nennt, für wen. */
export function planWeek(inp: PlanInput): PlanResult {
  const dates = weekDates(inp.monday)
  const slots = slotsFor(inp.types, inp.shifts, dates)
  const work = slots.map((s) => ({ ...s, shift: s.shift ? { ...s.shift } : null }))
  const active = inp.people.filter((p) => p.active && !p.deleted_at)
  const nameOf = (id: string | null | undefined) => inp.people.find((p) => p.id === id)?.name ?? 'Person'
  const live = inp.templateSlots.filter((t) => !t.deleted_at)

  const load = new Map<string, number>()
  const bump = (id: string) => load.set(id, (load.get(id) ?? 0) + 1)
  for (const s of work) if (s.shift?.person_id) bump(s.shift.person_id)

  const want = new Map<number, { person: string; reason: string }>() // Index im work -> wer ersetzt werden muss
  const assignments: PlannedAssignment[] = []
  const assign = (i: number, personId: string, note: string | null) => {
    const s = work[i]
    s.shift = { id: s.id, type_id: s.type.id, date: s.date, slot: s.slot, person_id: personId, notes: note, assigned_by: null, updated_at: '', deleted_at: null }
    bump(personId)
    assignments.push({ slot: slots[i], personId, note })
  }

  // 1. Vorlage übernehmen, wo möglich
  for (const [i, s] of work.entries()) {
    const existing = s.shift?.person_id ?? null
    if (existing) {
      if (inp.adjustExisting && absenceOn(existing, s.date, inp.absences)) {
        const a = absenceOn(existing, s.date, inp.absences)!
        want.set(i, { person: existing, reason: ABSENCE_LABEL[a.kind] ?? 'abwesend' })
        s.shift = null // Platz für den Ersatz freimachen
        load.set(existing, Math.max(0, (load.get(existing) ?? 1) - 1))
      }
      continue
    }
    const tpl = templateOn(inp.templates, s.date)
    if (!tpl) continue
    const ts = live.find((t) => t.template_id === tpl.id && t.week_no === weekNoOn(tpl, s.date) && t.weekday === weekdayIndex(s.date) && t.type_id === s.type.id && t.slot === s.slot)
    const pid = ts?.person_id
    if (!pid || !active.some((p) => p.id === pid)) continue
    const c = conflictsFor(pid, s, work, inp.skills, inp.absences)
    if (!hasConflict(c)) assign(i, pid, null)
    else want.set(i, { person: pid, reason: c.absent ? (ABSENCE_LABEL[c.absent.kind] ?? 'abwesend') : c.overlap.length ? 'gleichzeitig eingeteilt' : 'nicht befähigt' })
  }

  // 2. Ersatz für alle, die nicht können
  const unfilled: string[] = []
  for (const [i, why] of want) {
    const s = work[i]
    const candidates = active
      .filter((p) => p.id !== why.person && !hasConflict(conflictsFor(p.id, s, work, inp.skills, inp.absences)))
      .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'de-CH'))
    const pick = candidates[0]
    if (pick) assign(i, pick.id, `Ersatz für ${nameOf(why.person)} (${why.reason})`)
    else unfilled.push(`${s.date} ${s.type.start_time} ${s.type.animal ? `${s.type.animal} · ` : ''}${s.type.name}: ${nameOf(why.person)} ${why.reason}, niemand frei`)
  }
  return { assignments, unfilled }
}

/** Montage der Wochen von `fromMonday` bis `toMonday` (inklusive). */
export function mondaysBetween(fromMonday: string, toMonday: string): string[] {
  const out: string[] = []
  for (let m = fromMonday; m <= toMonday; m = addDays(m, 7)) out.push(m)
  return out
}

/** Bis zu welchem Datum müssen Wochen bestätigt sein? Wochen, die bis dahin beginnen, sind fällig. */
export const confirmDeadline = (today: string) => addMonths(today, CONFIRM_MONTHS)

export interface WeekState {
  monday: string
  status: 'entwurf' | 'bestaetigt' | 'fehlt'
  /** Entwurf (oder fehlend) und beginnt innerhalb der 2 Monate: überfällig */
  overdue: boolean
  /** Entwurf, beginnt in mehr als 2 Monaten: noch Zeit */
  upcoming: boolean
}

/** Status der Wochen ab der laufenden Woche bis `weeksAhead` Wochen voraus. */
export function weekStates(weeks: Pick<DutyWeek, 'week_start' | 'status' | 'deleted_at'>[], today: string, weeksAhead = GENERATE_AHEAD_WEEKS): WeekState[] {
  const deadline = confirmDeadline(today)
  const byStart = new Map(weeks.filter((w) => !w.deleted_at).map((w) => [w.week_start, w]))
  return mondaysBetween(mondayOf(today), addDays(mondayOf(today), weeksAhead * 7)).map((monday) => {
    const w = byStart.get(monday)
    const status = w ? w.status : 'fehlt'
    const open = status !== 'bestaetigt'
    return { monday, status, overdue: open && monday <= deadline, upcoming: open && monday > deadline }
  })
}

/** Plätze einer Woche als Vorlage übernehmen (z.B. «aus Woche X erstellen»): eingeteilte Personen je Platz. */
export function templateSlotsFromWeek(slots: Slot[], monday: string): { weekday: number; type_id: string; slot: number; person_id: string }[] {
  return slots
    .filter((s) => s.shift?.person_id && s.date >= monday && s.date <= addDays(monday, 6))
    .map((s) => ({ weekday: weekdayIndex(s.date), type_id: s.type.id, slot: s.slot, person_id: s.shift!.person_id! }))
}
