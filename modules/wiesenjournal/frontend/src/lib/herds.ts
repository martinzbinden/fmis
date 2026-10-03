// Herdengruppen und Standorte laden und ändern (schema/0017_herds.sql).
// Änderungen schliessen den bisherigen Zustand ab dem Vortag ab und öffnen
// einen neuen ab dem gewählten Tag — so bleibt der Verlauf erhalten ("wer
// stand wann wo"). Am selben Tag ersetzt eine Änderung die vorherige.

import type { PGlite } from '@electric-sql/pglite'
import type { AnimalRef } from '@fmis/core/animals'
import { animalProvider, type HerdLocator } from '@fmis/core/animals'
import { getDb } from '../db/pglite'
import { softDeleteRow, upsertRow } from '../db/write'
import { addDaysIso, isoDate } from './format'
import { activeAt, defaultCategory, locateAnimal } from './herdModel'
import type { HerdCount, HerdGroup, HerdLocation, HerdMember, HerdStay, StaySlot } from '../types'

const dates = <T extends { from_date: unknown; to_date: unknown }>(r: T) => ({
  ...r,
  from_date: isoDate(r.from_date as string),
  to_date: r.to_date == null ? null : isoDate(r.to_date as string),
})

export interface HerdData {
  locations: HerdLocation[]
  groups: HerdGroup[]
  stays: HerdStay[]
  members: HerdMember[]
  counts: HerdCount[]
  parcels: { id: string; name: string; season_year: number }[]
}

export async function loadHerdData(pg: PGlite, seasonYear?: number): Promise<HerdData> {
  const [locations, groups, stays, members, counts, parcels] = await Promise.all([
    pg.query<HerdLocation>('select * from locations where deleted_at is null order by sort_order, name'),
    pg.query<HerdGroup>('select * from herd_groups where deleted_at is null order by sort_order, name'),
    pg.query<HerdStay>('select * from herd_stays where deleted_at is null order by from_date'),
    pg.query<HerdMember>('select * from herd_members where deleted_at is null order by from_date'),
    pg.query<HerdCount>('select * from herd_counts where deleted_at is null order by from_date'),
    pg.query<{ id: string; name: string; season_year: number }>(
      `select id, name, season_year from parcels where deleted_at is null ${seasonYear ? 'and season_year = $1' : ''} order by name`,
      seasonYear ? [seasonYear] : [],
    ),
  ])
  return {
    locations: locations.rows,
    groups: groups.rows,
    stays: stays.rows.map(dates),
    members: members.rows.map(dates),
    counts: counts.rows.map((c) => ({ ...dates(c), count: Number(c.count) })),
    parcels: parcels.rows,
  }
}

/** Bisherige Zeile ab `date` beenden: am selben Tag begonnen → entfernen,
 * sonst Ende auf den Vortag setzen. */
async function closeFrom<T extends 'herd_stays' | 'herd_members' | 'herd_counts'>(
  table: T,
  row: { id: string; from_date: string; to_date: string | null },
  date: string,
) {
  if (row.from_date >= date) await softDeleteRow(table, row.id)
  else await upsertRow(table, { ...row, to_date: addDaysIso(date, -1) } as never)
}

export async function saveGroup(group: HerdGroup): Promise<void> {
  await upsertRow('herd_groups', group as never)
}

/** Stall oder Weide einer Gruppe ab `date` wechseln (target null = keine). */
export async function changeStay(
  data: HerdData,
  groupId: string,
  slot: StaySlot,
  target: { location_id: string | null; parcel_id: string | null; day_only?: boolean } | null,
  date: string,
): Promise<void> {
  for (const s of data.stays.filter((x) => x.group_id === groupId && x.slot === slot && (x.to_date == null || x.to_date >= date))) {
    await closeFrom('herd_stays', s, date)
  }
  if (!target) return
  await upsertRow('herd_stays', {
    id: crypto.randomUUID(),
    group_id: groupId,
    slot,
    location_id: target.location_id,
    parcel_id: target.parcel_id,
    day_only: target.day_only ?? false,
    from_date: date,
    to_date: null,
    notes: null,
  })
}

/** Tiere ohne Nummer einer Kategorie ab `date` auf `count` setzen. */
export async function setCount(data: HerdData, groupId: string, category: string, count: number, date: string): Promise<void> {
  for (const c of data.counts.filter((x) => x.group_id === groupId && x.category === category && (x.to_date == null || x.to_date >= date))) {
    await closeFrom('herd_counts', c, date)
  }
  if (count > 0) {
    await upsertRow('herd_counts', {
      id: crypto.randomUUID(),
      group_id: groupId,
      category,
      count,
      from_date: date,
      to_date: null,
      notes: null,
    })
  }
}

export function countAt(data: HerdData, groupId: string, category: string, date: string): number {
  return data.counts.filter((c) => c.group_id === groupId && c.category === category && activeAt(c, date)).reduce((s, c) => s + c.count, 0)
}

/** Wo steht ein Einzeltier am Tag `date`? */
export function memberAt(data: HerdData, animalId: string, date: string): HerdMember | undefined {
  return data.members.find((m) => m.animal_id === animalId && activeAt(m, date))
}

export interface MoveInput {
  toGroup: HerdGroup
  fromGroup: HerdGroup | null
  date: string
  animals: AnimalRef[]
  /** Tiere ohne Nummer je Kategorie, die mitkommen */
  counts: Record<string, number>
  /** Kategorie je Einzeltier (sonst Vorschlag) */
  categories?: Record<string, string>
  dryOff: boolean
}

/** Tiere zügeln: Einzeltiere verlassen ihre bisherige Gruppe (welche auch
 * immer) und kommen ab `date` in die Zielgruppe; Tiere ohne Nummer werden
 * in der Herkunft abgezogen und im Ziel dazugezählt. Optional werden
 * Einzeltiere aus einer gemolkenen Gruppe trockengestellt. */
export async function moveAnimals(data: HerdData, input: MoveInput): Promise<void> {
  const { toGroup, fromGroup, date } = input
  for (const a of input.animals) {
    for (const m of data.members.filter((x) => x.animal_id === a.id && (x.to_date == null || x.to_date >= date))) {
      await closeFrom('herd_members', m, date)
    }
    await upsertRow('herd_members', {
      id: crypto.randomUUID(),
      group_id: toGroup.id,
      module_key: a.moduleKey,
      animal_id: a.id,
      label: a.name ? `${a.label} ${a.name}` : a.label,
      category: input.categories?.[a.id] ?? defaultCategory({ ...a, dry: a.dry || input.dryOff }, toGroup.milking, date),
      from_date: date,
      to_date: null,
    })
  }
  for (const [cat, n] of Object.entries(input.counts)) {
    if (!n) continue
    if (fromGroup) await setCount(data, fromGroup.id, cat, Math.max(0, countAt(data, fromGroup.id, cat, date) - n), date)
    // setCount liest data — das Ziel hat sich durch die Herkunft nicht verändert
    await setCount(data, toGroup.id, cat, countAt(data, toGroup.id, cat, date) + n, date)
  }
  if (input.dryOff) {
    const byModule = new Map<string, string[]>()
    for (const a of input.animals) byModule.set(a.moduleKey, [...(byModule.get(a.moduleKey) ?? []), a.id])
    for (const [key, ids] of byModule) {
      await animalProvider(key)?.dryOff?.(ids, date, `trockengestellt, gezügelt nach «${toGroup.name}»`)
    }
  }
}

/** Einzeltiere aus der Gruppe nehmen (Abgang, Verkauf …) ab `date`. */
export async function removeMembers(data: HerdData, memberIds: string[], date: string): Promise<void> {
  for (const m of data.members.filter((x) => memberIds.includes(x.id))) await closeFrom('herd_members', m, date)
}

export async function saveLocation(loc: HerdLocation): Promise<void> {
  await upsertRow('locations', loc as never)
}

/** Standort eines Tiers für das Tierdetail anderer Module (core animals.ts). */
export const wiesenjournalHerdLocator: HerdLocator = {
  herdsPath: '/wiesenjournal/herden',
  async locate(_moduleKey, animalId, date) {
    const data = await loadHerdData(await getDb())
    return locateAnimal(data, animalId, date)
  },
}

/** Bestand klären: Einzeltiere ab `date` in der Gruppe führen (aus einer
 * allfälligen anderen Gruppe heraus) und — weil sie dort bisher als Anzahl
 * ohne Nummer gezählt waren — diese Anzahl je Kategorie entsprechend
 * verringern. Tiere, die schon in der Gruppe sind, bleiben unverändert. */
export async function identifyAnimals(
  data: HerdData,
  group: HerdGroup,
  animals: AnimalRef[],
  categories: Record<string, string>,
  date: string,
  reduceCounts: boolean,
): Promise<void> {
  const perCategory = new Map<string, number>()
  for (const a of animals) {
    const open = data.members.filter((m) => m.animal_id === a.id && (m.to_date == null || m.to_date >= date))
    if (open.some((m) => m.group_id === group.id && m.from_date <= date)) continue
    for (const m of open) await closeFrom('herd_members', m, date)
    const category = categories[a.id] ?? defaultCategory(a, group.milking, date)
    await upsertRow('herd_members', {
      id: crypto.randomUUID(),
      group_id: group.id,
      module_key: a.moduleKey,
      animal_id: a.id,
      label: a.name ? `${a.label} ${a.name}` : a.label,
      category,
      from_date: date,
      to_date: null,
    })
    perCategory.set(category, (perCategory.get(category) ?? 0) + 1)
  }
  if (!reduceCounts) return
  for (const [cat, n] of perCategory) {
    const before = countAt(data, group.id, cat, date)
    if (before > 0) await setCount(data, group.id, cat, Math.max(0, before - n), date)
  }
}
