// Ferienplan: Abwesenheiten eines Jahres je Person als Balken, Tage mit mehreren Abwesenden als Überschneidung.
// Beantragte (noch nicht bestätigte) Wünsche zählen mit, sind aber als solche markiert.

import { addDays, weekdayIndex } from './duty'
import type { DutyAbsence, DutyAbsenceKind, DutyRequest } from '../types'

export interface PlanEntry {
  personId: string
  from: string
  to: string
  kind: DutyAbsenceKind
  /** Wunsch, noch nicht bestätigt */
  pending: boolean
  notes: string | null
}

export interface Overlap {
  from: string
  to: string
  who: { personId: string; kind: DutyAbsenceKind; pending: boolean }[]
}

const yearStart = (y: number) => `${y}-01-01`
const yearEnd = (y: number) => `${y}-12-31`

/** Abwesenheiten und offene Wünsche, die ins Jahr fallen (auf das Jahr gekürzt). */
export function planEntries(absences: DutyAbsence[], requests: DutyRequest[], year: number, personIds?: Set<string>): PlanEntry[] {
  const a = yearStart(year)
  const b = yearEnd(year)
  const out: PlanEntry[] = []
  const push = (e: PlanEntry) => {
    // Einträge gelöschter Personen zählen nicht
    if (personIds && !personIds.has(e.personId)) return
    if (e.to < a || e.from > b || e.to < e.from) return
    out.push({ ...e, from: e.from < a ? a : e.from, to: e.to > b ? b : e.to })
  }
  for (const x of absences) if (!x.deleted_at && !x.missing_since) push({ personId: x.person_id, from: x.from_date, to: x.to_date, kind: x.kind, pending: false, notes: x.notes })
  for (const r of requests)
    if (!r.deleted_at && r.kind === 'wunsch' && r.status === 'offen' && r.from_date && r.to_date)
      push({ personId: r.person_id, from: r.from_date, to: r.to_date, kind: r.absence_kind ?? 'frei', pending: true, notes: r.notes })
  return out.sort((x, y) => x.from.localeCompare(y.from) || x.personId.localeCompare(y.personId))
}

/** Personen, die gemeinsam Ferien machen (absence_with, in beide Richtungen und über Ketten), auf einen Schlüssel
 * abbilden: sie zählen im Ferienplan als eine Einheit. */
export function absenceUnits(people: { id: string; absence_with?: string | null }[]): (personId: string) => string {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    const p = parent.get(x) ?? x
    if (p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }
  for (const p of people) if (p.absence_with) {
    const a = find(p.id)
    const b = find(p.absence_with)
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b)
  }
  return find
}

/** Tage, an denen mindestens zwei Personen (bzw. Einheiten gemeinsam Abwesender) weg sind, zu Zeiträumen mit
 * gleicher Besetzung zusammengefasst. Ohne `withSchool` zählen Schultage nicht. */
export function overlaps(entries: PlanEntry[], { withSchool = true, unitOf = (id: string) => id }: { withSchool?: boolean; unitOf?: (id: string) => string } = {}): Overlap[] {
  const byDay = new Map<string, Map<string, Overlap['who'][number]>>()
  for (const e of entries) {
    if (!withSchool && e.kind === 'schule') continue
    for (let d = e.from; d <= e.to; d = addDays(d, 1)) {
      const m = byDay.get(d) ?? new Map()
      // eine Person zählt einmal; bestätigt geht vor Wunsch, Ferien/Kurs vor dem Schultag
      const prev = m.get(e.personId)
      const rank = (w: { kind: DutyAbsenceKind; pending: boolean }) => (w.pending ? 2 : 0) + (w.kind === 'schule' ? 1 : 0)
      if (!prev || rank(e) < rank(prev)) m.set(e.personId, { personId: e.personId, kind: e.kind, pending: e.pending })
      byDay.set(d, m)
    }
  }
  const days = [...byDay.entries()].filter(([, m]) => new Set([...m.keys()].map(unitOf)).size >= 2).sort(([a], [b]) => a.localeCompare(b))
  const out: Overlap[] = []
  const sig = (m: Map<string, Overlap['who'][number]>) => [...m.values()].map((w) => `${w.personId}:${w.kind}:${w.pending}`).sort().join('|')
  let lastSig = ''
  for (const [d, m] of days) {
    const s = sig(m)
    const last = out.at(-1)
    if (last && s === lastSig && addDays(last.to, 1) === d) last.to = d
    else out.push({ from: d, to: d, who: [...m.values()].sort((a, b) => a.personId.localeCompare(b.personId)) })
    lastSig = s
  }
  return out
}

/** Ferientage einer Person im Jahr: Kalendertage und Arbeitstage (Mo–Fr), bestätigt und als Wunsch getrennt. */
export function vacationDays(entries: PlanEntry[], personId: string): { days: number; workdays: number; pendingDays: number } {
  const seen = new Map<string, boolean>()
  for (const e of entries)
    if (e.personId === personId && e.kind === 'ferien') for (let d = e.from; d <= e.to; d = addDays(d, 1)) seen.set(d, (seen.get(d) ?? true) && e.pending)
  let days = 0
  let workdays = 0
  let pendingDays = 0
  for (const [d, pending] of seen) {
    if (pending) pendingDays++
    else {
      days++
      if (weekdayIndex(d) < 5) workdays++
    }
  }
  return { days, workdays, pendingDays }
}

/** Tag im Jahr, 0-basiert */
export const dayOfYear = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${iso.slice(0, 4)}-01-01T12:00:00Z`)) / 86_400_000)
export const daysInYear = (y: number) => dayOfYear(yearEnd(y)) + 1
