// Auslauf (RAUS) aus den Herdengruppen — reine Funktionen (getestet).
//
// Je Gruppe und Tag: Weide (Aufenthalt slot 'weide'), Laufhof (Eintrag in
// herd_laufhof) oder Laufhof ständig (Stall mit ständig zugänglichem
// Laufhof, schema/0018). Daraus der Monatszähler gegen die RAUS-Vorgabe und
// die Laufhof-Zeilen der Tagesmeldung je Journal-Kategorie.

import type { AnimalCategory, HerdCount, HerdGroup, HerdLaufhof, HerdLocation, HerdMember, HerdStay, LaufhofMode } from '../types'
import { activeAt, compositionAt, journalCategory } from './herdModel'
import { addDaysIso } from './format'

export type AccessKind = 'weide' | 'laufhof' | 'laufhof_staendig'

export const ACCESS_LABEL: Record<AccessKind, string> = {
  weide: 'Weide',
  laufhof: 'Laufhof',
  laufhof_staendig: 'Laufhof (ständig)',
}

export interface AccessInput {
  groups: HerdGroup[]
  stays: HerdStay[]
  members: HerdMember[]
  counts: HerdCount[]
  locations: Pick<HerdLocation, 'id' | 'laufhof'>[]
  laufhof: HerdLaufhof[]
}

export interface GroupDay {
  /** Tiere in der Gruppe an diesem Tag */
  animals: number
  /** Auslauf an diesem Tag, null = keiner (bzw. noch nicht erfasst) */
  kind: AccessKind | null
  /** Laufhof des Stalls an diesem Tag */
  stallLaufhof: LaufhofMode | null
  /** Laufhofgang erfasst (auch wenn die Weide Vorrang hat) */
  laufhofEntry: boolean
}

const laufhofKey = (groupId: string, date: string) => `${groupId}|${date}`

/** Vorberechneter Zugriff — Raster und Monatsansicht fragen hunderte Tage ab. */
export function accessIndex(input: AccessInput) {
  const entries = new Set(input.laufhof.filter((l) => !l.deleted_at).map((l) => laufhofKey(l.group_id, l.entry_date)))
  const locLaufhof = new Map(input.locations.map((l) => [l.id, l.laufhof]))
  const staysByGroup = new Map<string, HerdStay[]>()
  for (const s of input.stays) if (!s.deleted_at) staysByGroup.set(s.group_id, [...(staysByGroup.get(s.group_id) ?? []), s])

  function groupDay(groupId: string, date: string): GroupDay {
    const animals = compositionAt(groupId, input.members, input.counts, date).total
    const stays = staysByGroup.get(groupId) ?? []
    const weide = stays.find((s) => s.slot === 'weide' && activeAt(s, date))
    const stall = stays.find((s) => s.slot === 'stall' && activeAt(s, date))
    const stallLaufhof = stall?.location_id ? (locLaufhof.get(stall.location_id) ?? 'keiner') : null
    const laufhofEntry = entries.has(laufhofKey(groupId, date))
    const kind: AccessKind | null = weide ? 'weide' : laufhofEntry ? 'laufhof' : stallLaufhof === 'staendig' ? 'laufhof_staendig' : null
    return { animals, kind, stallLaufhof, laufhofEntry }
  }
  return { groupDay }
}
export type AccessIndex = ReturnType<typeof accessIndex>

// --- RAUS-Vorgabe ---

/** Winter = 1. November bis 30. April. */
export const isWinterMonth = (month: string) => {
  const m = Number(month.slice(5, 7))
  return m >= 11 || m <= 4
}

/** Mindesttage je Monat: Sommer Weidetage, Winter Auslauftage (Weide oder
 * Laufhof). Stand der Vorgabe bei der Umsetzung — im Zweifel die aktuelle
 * DZV prüfen. */
export const RAUS_SUMMER_WEIDE_DAYS = 26
export const RAUS_WINTER_ACCESS_DAYS = 13

export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()

export type CounterState = 'erfuellt' | 'offen' | 'knapp' | 'verfehlt'

export interface MonthCounter {
  month: string
  winter: boolean
  /** Tage, die zählen (Sommer: Weide, Winter: Weide oder Laufhof) */
  done: number
  weide: number
  laufhof: number
  /** Tage mit Tieren in der Gruppe bis heute */
  present: number
  /** Vorgabe, anteilig auf die Tage mit Tieren im Monat */
  target: number
  /** noch mögliche Tage bis Monatsende (inkl. heute, falls noch offen) */
  possible: number
  state: CounterState
}

/** Zähler für eine Gruppe im Monat `month` (YYYY-MM), Stand `today`.
 * Steht die Gruppe heute mit Tieren da, wird sie bis Monatsende mitgezählt;
 * sonst nur die Tage, an denen sie Tiere hatte. */
export function monthCounter(idx: AccessIndex, groupId: string, month: string, today: string): MonthCounter | null {
  const first = `${month}-01`
  if (first > today) return null
  const n = daysInMonth(month)
  const last = `${month}-${String(n).padStart(2, '0')}`
  const winter = isWinterMonth(month)
  let done = 0
  let weide = 0
  let laufhof = 0
  let present = 0
  let todayOpen = false
  let presentToday = false
  for (let d = first; d <= last && d <= today; d = addDaysIso(d, 1)) {
    const day = idx.groupDay(groupId, d)
    if (day.animals <= 0) continue
    present++
    if (day.kind === 'weide') weide++
    else if (day.kind) laufhof++
    const counts = winter ? day.kind != null : day.kind === 'weide'
    if (counts) done++
    if (d === today) {
      presentToday = true
      todayOpen = !counts
    }
  }
  if (present === 0) return null
  const remainingAfterToday = today < last && presentToday ? Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : 0
  const expectedPresent = present + remainingAfterToday
  const base = winter ? RAUS_WINTER_ACCESS_DAYS : RAUS_SUMMER_WEIDE_DAYS
  const target = Math.ceil((base * expectedPresent) / n)
  const possible = remainingAfterToday + (todayOpen ? 1 : 0)
  const state: CounterState =
    done >= target ? 'erfuellt' : done + possible < target ? 'verfehlt' : done + possible - target <= 3 ? 'knapp' : 'offen'
  return { month, winter, done, weide, laufhof, present, target, possible, state }
}

// --- Tagesmeldung je Journal-Kategorie ---

export interface CategoryDay {
  /** Tiere dieser Kategorie in Gruppen */
  animals: number
  /** davon mit Auslauf */
  withAccess: number
  groups: { id: string; name: string; animals: number; kind: AccessKind | null }[]
}

/** Je Journal-Kategorie (kuehe, rinder, …): Tiere in Gruppen und wie viele
 * davon an diesem Tag Auslauf hatten. */
export function categoryDay(idx: AccessIndex, input: AccessInput, date: string): Map<AnimalCategory, CategoryDay> {
  const out = new Map<AnimalCategory, CategoryDay>()
  for (const g of input.groups) {
    if (g.deleted_at) continue
    const comp = compositionAt(g.id, input.members, input.counts, date)
    if (comp.total <= 0) continue
    const day = idx.groupDay(g.id, date)
    const perJournal = new Map<AnimalCategory, number>()
    for (const [cat, n] of comp.byCategory) {
      const j = journalCategory(cat)
      perJournal.set(j, (perJournal.get(j) ?? 0) + n.identified + n.anonymous)
    }
    for (const [cat, n] of perJournal) {
      const e = out.get(cat) ?? { animals: 0, withAccess: 0, groups: [] }
      e.animals += n
      if (day.kind) e.withAccess += n
      e.groups.push({ id: g.id, name: g.name, animals: n, kind: day.kind })
      out.set(cat, e)
    }
  }
  return out
}

/** Zeichen im Raster: ✓ alle Tiere mit Auslauf, ◐ ein Teil, sonst nichts. */
export function categoryMark(c: CategoryDay | undefined): '✓' | '◐' | null {
  if (!c || c.animals <= 0 || c.withAccess <= 0) return null
  return c.withAccess >= c.animals ? '✓' : '◐'
}

export function categoryTitle(c: CategoryDay): string {
  return c.groups.map((g) => `${g.name} (${g.animals}): ${g.kind ? ACCESS_LABEL[g.kind] : 'kein Auslauf'}`).join('\n')
}
