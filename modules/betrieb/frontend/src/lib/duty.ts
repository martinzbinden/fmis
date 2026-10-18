// Dienstplan — reine Funktionen (getestet): Wochen, Plätze je Tag,
// Konflikte (abwesend, gleichzeitig, nicht befähigt), fairer Vorschlag.

import type { DutyAbsence, DutyPerson, DutyShift, DutySkill, DutyType } from '../types'
import { localTodayIso } from '@fmis/core/dates'

const DAY = 86_400_000
const parse = (iso: string) => new Date(`${iso}T12:00:00Z`)
const fmt = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => fmt(new Date(parse(iso).getTime() + n * DAY))
/** Heute in Ortszeit (nicht UTC: kurz nach Mitternacht sonst der Vortag). */
export function localToday(now = new Date()): string {
  return localTodayIso(now)
}

/** 0 = Montag … 6 = Sonntag */
export const weekdayIndex = (iso: string) => (parse(iso).getUTCDay() + 6) % 7
export const mondayOf = (iso: string) => addDays(iso, -weekdayIndex(iso))
export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i))

/** ISO-Kalenderwoche */
export function isoWeek(iso: string): number {
  const d = parse(iso)
  const thursday = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * DAY)
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((thursday.getTime() - jan4.getTime()) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)
}

/** Anzahl Plätze dieses Diensttyps an einem Tag. */
export function slotsOn(type: Pick<DutyType, 'weekdays' | 'active'>, iso: string): number {
  if (!type.active) return 0
  const n = Number(type.weekdays[weekdayIndex(iso)] ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Feste id eines Platzes (Typ + Datum + Platz): zwei Geräte belegen denselben Platz nicht doppelt. */
export function shiftId(typeId: string, date: string, slot: number): string {
  const text = `duty|${typeId}|${date}|${slot}`
  let hex = ''
  for (const seed of [0x811c9dc5, 0x01000193, 0x5bd1e995, 0x27d4eb2d]) {
    let h = seed >>> 0
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    hex += h.toString(16).padStart(8, '0')
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export function timeRange(type: Pick<DutyType, 'start_time' | 'duration_min'>): [number, number] {
  const s = minutes(type.start_time)
  return [s, s + Math.max(1, type.duration_min)]
}
export const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1]
export const endTime = (type: Pick<DutyType, 'start_time' | 'duration_min'>) => {
  const e = timeRange(type)[1]
  return `${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`
}

export function absenceOn(personId: string, iso: string, absences: DutyAbsence[]): DutyAbsence | null {
  return absences.find((a) => !a.deleted_at && a.person_id === personId && a.from_date <= iso && iso <= a.to_date) ?? null
}

export const canDo = (personId: string, typeId: string, skills: DutySkill[]) => skills.some((s) => !s.deleted_at && s.person_id === personId && s.type_id === typeId)

export interface Slot {
  type: DutyType
  date: string
  slot: number
  id: string
  shift: DutyShift | null
}

/** Alle Plätze der Tage (aktive Typen, sortiert nach Tag und Uhrzeit). */
export function slotsFor(types: DutyType[], shifts: DutyShift[], dates: string[]): Slot[] {
  const byId = new Map(shifts.filter((s) => !s.deleted_at && s.person_id).map((s) => [s.id, s]))
  const out: Slot[] = []
  const sorted = [...types].filter((t) => !t.deleted_at).sort((a, b) => a.start_time.localeCompare(b.start_time) || a.sort_order - b.sort_order)
  for (const date of dates)
    for (const type of sorted)
      for (let slot = 0; slot < slotsOn(type, date); slot++) {
        const id = shiftId(type.id, date, slot)
        out.push({ type, date, slot, id, shift: byId.get(id) ?? null })
      }
  return out
}

export interface Conflict {
  absent: DutyAbsence | null
  /** gleichzeitig eingeteilte Dienste dieser Person */
  overlap: string[]
  unskilled: boolean
}

export function conflictsFor(personId: string, slot: Pick<Slot, 'type' | 'date' | 'id'>, all: Slot[], skills: DutySkill[], absences: DutyAbsence[]): Conflict {
  const r = timeRange(slot.type)
  const overlap = all
    .filter((o) => o.id !== slot.id && o.date === slot.date && o.shift?.person_id === personId && overlaps(r, timeRange(o.type)))
    .map((o) => o.type.name)
  return { absent: absenceOn(personId, slot.date, absences), overlap, unskilled: !canDo(personId, slot.type.id, skills) }
}
export const hasConflict = (c: Conflict) => !!c.absent || c.overlap.length > 0 || c.unskilled

/** Vorschlag für offene Plätze: befähigt, nicht abwesend, nicht gleichzeitig
 * eingeteilt; bei mehreren die Person mit den wenigsten Diensten dieser
 * Woche (gleichmässig verteilt), bei Gleichstand die mit diesem Dienst
 * zuletzt am wenigsten. */
export function suggest(slots: Slot[], people: DutyPerson[], skills: DutySkill[], absences: DutyAbsence[]): { slot: Slot; personId: string }[] {
  const work = slots.map((s) => ({ ...s, shift: s.shift ? { ...s.shift } : null }))
  const load = new Map<string, number>()
  const sameType = new Map<string, number>()
  for (const s of work)
    if (s.shift?.person_id) {
      load.set(s.shift.person_id, (load.get(s.shift.person_id) ?? 0) + 1)
      sameType.set(`${s.shift.person_id}|${s.type.id}`, (sameType.get(`${s.shift.person_id}|${s.type.id}`) ?? 0) + 1)
    }
  const active = people.filter((p) => p.active && !p.deleted_at)
  const out: { slot: Slot; personId: string }[] = []
  for (const [i, s] of work.entries()) {
    if (s.shift?.person_id) continue
    const candidates = active
      .filter((p) => !hasConflict(conflictsFor(p.id, s, work, skills, absences)))
      .sort(
        (a, b) =>
          (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) ||
          (sameType.get(`${a.id}|${s.type.id}`) ?? 0) - (sameType.get(`${b.id}|${s.type.id}`) ?? 0) ||
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name, 'de-CH'),
      )
    const p = candidates[0]
    if (!p) continue
    s.shift = { id: s.id, type_id: s.type.id, date: s.date, slot: s.slot, person_id: p.id, notes: null, assigned_by: null, updated_at: '', deleted_at: null }
    load.set(p.id, (load.get(p.id) ?? 0) + 1)
    sameType.set(`${p.id}|${s.type.id}`, (sameType.get(`${p.id}|${s.type.id}`) ?? 0) + 1)
    // der unveränderte (offene) Platz: assignSlots vergleicht mit dem bisherigen Stand
    out.push({ slot: slots[i], personId: p.id })
  }
  return out
}

/** Einteilung der Vorwoche übernehmen, wo der Platz offen ist und die
 * Person kann und da ist. */
export function copyFromPrevious(slots: Slot[], previous: Slot[], skills: DutySkill[], absences: DutyAbsence[]): { slot: Slot; personId: string }[] {
  const prev = new Map(previous.filter((p) => p.shift?.person_id).map((p) => [`${p.type.id}|${weekdayIndex(p.date)}|${p.slot}`, p.shift!.person_id!]))
  const work = slots.map((s) => ({ ...s }))
  const out: { slot: Slot; personId: string }[] = []
  for (const [i, s] of work.entries()) {
    if (s.shift?.person_id) continue
    const pid = prev.get(`${s.type.id}|${weekdayIndex(s.date)}|${s.slot}`)
    if (!pid || hasConflict(conflictsFor(pid, s, work, skills, absences))) continue
    s.shift = { id: s.id, type_id: s.type.id, date: s.date, slot: s.slot, person_id: pid, notes: null, assigned_by: null, updated_at: '', deleted_at: null }
    out.push({ slot: slots[i], personId: pid })
  }
  return out
}
