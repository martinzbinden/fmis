// Lücken durch eine Abwesenheit (Ferien eintragen, Antrag bestätigen): welche Dienste der Person laut Dienstplan
// oder Standardplan im Zeitraum zufallen, wer stattdessen einspringen kann und ein Vorschlag (wie planWeek: befähigt,
// frei, nicht gleichzeitig eingeteilt, zuerst wer unter seinem Pensum ist).

import { addDays, conflictsFor, hasConflict, slotsFor, weekdayIndex, type Conflict, type Slot } from './duty'
import { templateOn, weekNoOn } from './dutyPlan'
import { compareRank, loadFulltimeHours, targetMinutes, workloadRank } from './workload'
import type { DutyAbsence, DutyPerson, DutyShift, DutySkill, DutyTemplate, DutyTemplateSlot, DutyType } from '../types'

export type GapState = 'eingeteilt' | 'standard' | 'ersetzt'

export interface Gap {
  slot: Slot
  /** eingeteilt = die abwesende Person steht im Dienstplan; standard = Woche noch ohne Einteilung, laut Standardplan
   * die abwesende Person; ersetzt = schon jemand anderes eingeteilt */
  state: GapState
  /** wer jetzt eingeteilt ist (bei «ersetzt») */
  current: string | null
  /** Vorschlag für den Ersatz (null = niemand frei) */
  suggestion: string | null
  /** alle anderen aktiven Personen mit ihren Hinderungsgründen, Vorschlagsreihenfolge */
  candidates: { personId: string; conflict: Conflict }[]
}

export interface GapInput {
  personId: string
  from: string
  to: string
  types: DutyType[]
  shifts: DutyShift[]
  templates: DutyTemplate[]
  templateSlots: DutyTemplateSlot[]
  people: DutyPerson[]
  skills: DutySkill[]
  /** alle Abwesenheiten im Zeitraum, die neue eingeschlossen */
  absences: DutyAbsence[]
  fulltimeHours?: number
}

/** Höchstens so viele Tage (lange Abwesenheiten: der Rest folgt beim Erzeugen der Wochen automatisch). */
export const GAP_MAX_DAYS = 92

export function dateRange(from: string, to: string, max = GAP_MAX_DAYS): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < max; d = addDays(d, 1)) out.push(d)
  return out
}

/** Person laut Standardplan auf diesem Platz (null = keine Vorlage oder leer). */
export function templatePerson(slot: Pick<Slot, 'date' | 'type' | 'slot'>, templates: DutyTemplate[], templateSlots: DutyTemplateSlot[]): string | null {
  const tpl = templateOn(templates, slot.date)
  if (!tpl) return null
  const wk = weekNoOn(tpl, slot.date)
  const wd = weekdayIndex(slot.date)
  return templateSlots.find((t) => !t.deleted_at && t.template_id === tpl.id && t.week_no === wk && t.weekday === wd && t.type_id === slot.type.id && t.slot === slot.slot)?.person_id ?? null
}

export function findGaps(inp: GapInput): Gap[] {
  const dates = dateRange(inp.from, inp.to)
  if (dates.length === 0) return []
  const name = inp.people.find((p) => p.id === inp.personId)?.name ?? ''
  const slots = slotsFor(inp.types, inp.shifts, dates)
  // Arbeitsstand: eingeteilte Person, sonst (Woche noch nicht erzeugt) die aus dem Standardplan — so sieht der
  // Vorschlag auch Dienste, die erst noch entstehen
  const work: Slot[] = slots.map((s) => {
    if (s.shift?.person_id) return { ...s, shift: { ...s.shift } }
    const tp = templatePerson(s, inp.templates, inp.templateSlots)
    return { ...s, shift: tp ? { id: s.id, type_id: s.type.id, date: s.date, slot: s.slot, person_id: tp, notes: null, assigned_by: null, updated_at: '', deleted_at: null } : null }
  })

  const active = inp.people.filter((p) => p.active && !p.deleted_at && p.id !== inp.personId)
  const minutes = new Map<string, number>()
  for (const s of work) if (s.shift?.person_id) minutes.set(s.shift.person_id, (minutes.get(s.shift.person_id) ?? 0) + Math.max(0, s.type.duration_min))
  const fulltime = inp.fulltimeHours ?? loadFulltimeHours()
  const weeks = Math.max(1, dates.length / 7)
  const rank = (p: DutyPerson) => workloadRank((minutes.get(p.id) ?? 0) / weeks, targetMinutes(p, fulltime))

  const gaps: Gap[] = []
  for (const [i, s] of slots.entries()) {
    const cur = s.shift?.person_id ?? null
    const tp = templatePerson(s, inp.templates, inp.templateSlots)
    let state: GapState | null = null
    if (cur === inp.personId) state = 'eingeteilt'
    else if (!cur && tp === inp.personId) state = 'standard'
    else if (cur && (tp === inp.personId || (!!name && (s.shift?.notes ?? '').includes(`Ersatz für ${name}`)))) state = 'ersetzt'
    if (!state) continue
    // die abwesende Person gibt den Platz frei
    if (state !== 'ersetzt' && work[i].shift) {
      minutes.set(inp.personId, Math.max(0, (minutes.get(inp.personId) ?? 0) - s.type.duration_min))
      work[i] = { ...work[i], shift: null }
    }
    const candidates = active
      .map((p) => ({ personId: p.id, conflict: conflictsFor(p.id, work[i], work, inp.skills, inp.absences), p }))
      .sort((a, b) => Number(hasConflict(a.conflict)) - Number(hasConflict(b.conflict)) || compareRank(rank(a.p), rank(b.p)) || (minutes.get(a.p.id) ?? 0) - (minutes.get(b.p.id) ?? 0) || a.p.sort_order - b.p.sort_order || a.p.name.localeCompare(b.p.name, 'de-CH'))
    let suggestion: string | null = null
    if (state === 'ersetzt') suggestion = cur
    else {
      const pick = candidates.find((c) => !hasConflict(c.conflict))
      if (pick) {
        suggestion = pick.personId
        work[i] = { ...work[i], shift: { id: s.id, type_id: s.type.id, date: s.date, slot: s.slot, person_id: pick.personId, notes: null, assigned_by: null, updated_at: '', deleted_at: null } }
        minutes.set(pick.personId, (minutes.get(pick.personId) ?? 0) + Math.max(0, s.type.duration_min))
      }
    }
    gaps.push({ slot: s, state, current: state === 'ersetzt' ? cur : null, suggestion, candidates: candidates.map(({ personId, conflict }) => ({ personId, conflict })) })
  }
  return gaps.sort((a, b) => a.slot.date.localeCompare(b.slot.date) || a.slot.type.start_time.localeCompare(b.slot.type.start_time))
}
