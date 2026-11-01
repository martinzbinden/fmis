// Herdengruppen und Standorte laden und ändern (schema/0017_herds.sql).
// Änderungen schliessen den bisherigen Zustand ab dem Vortag ab und öffnen
// einen neuen ab dem gewählten Tag — so bleibt der Verlauf erhalten ("wer
// stand wann wo"). Am selben Tag ersetzt eine Änderung die vorherige.
// Jede Aktion läuft als EINE Transaktion (writeBatch): bricht sie ab oder wird
// die App geschlossen, steht keine Gruppe halb umgestellt da, und
// «Rückgängig» nimmt immer die ganze Aktion zurück.

import type { PGlite } from '@electric-sql/pglite'
import type { AnimalRef } from '@fmis/core/animals'
import { animalProvider, type HerdLocator } from '@fmis/core/animals'
import { getSyncedDb } from '../db/access'
import { getSyncedDb as getWiesenjournalDb } from '@fmis/wiesenjournal/db/access'
import type { BatchWriter } from '@fmis/core/writer'
import { writeBatch } from '../db/write'
import type { SYNC_TABLES } from '../db/tables'
import { addDaysIso, isoDate } from './format'
import { activeAt, defaultCategory, doubleMemberships, locateAnimal } from './herdModel'
import type { HerdCount, HerdGroup, HerdLaufhof, HerdLocation, HerdMember, HerdStay, StaySlot } from '../types'

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
  /** Laufhofgänge (schema/0018) */
  laufhof: HerdLaufhof[]
  parcels: { id: string; name: string; season_year: number }[]
}

/** Liest aus der Tiere-Ablage — auch von anderen Modulen aus aufrufbar
 * (Wiesenjournal leitet daraus die Weidebelegung ab). */
export async function loadHerdData(seasonYear?: number): Promise<HerdData> {
  const pg = await getSyncedDb()
  const [locations, groups, stays, members, counts, laufhof, parcels] = await Promise.all([
    pg.query<HerdLocation>('select * from locations where deleted_at is null order by sort_order, name'),
    pg.query<HerdGroup>('select * from herd_groups where deleted_at is null order by sort_order, name'),
    pg.query<HerdStay>('select * from herd_stays where deleted_at is null order by from_date'),
    pg.query<HerdMember>('select * from herd_members where deleted_at is null order by from_date'),
    pg.query<HerdCount>('select * from herd_counts where deleted_at is null order by from_date'),
    pg.query<HerdLaufhof>('select * from herd_laufhof where deleted_at is null order by entry_date'),
    // Parzellen gehören dem Wiesenjournal (eigenes Schema/Sync).
    getWiesenjournalDb().then((wj) => wj.query<{ id: string; name: string; season_year: number }>(
      `select id, name, season_year from parcels where deleted_at is null ${seasonYear ? 'and season_year = $1' : ''} order by name`,
      seasonYear ? [seasonYear] : [],
    )),
  ])
  return {
    locations: locations.rows,
    groups: groups.rows,
    stays: stays.rows.map(dates),
    members: members.rows.map(dates),
    counts: counts.rows.map((c) => ({ ...dates(c), count: Number(c.count) })),
    laufhof: laufhof.rows.map((l) => ({ ...l, entry_date: isoDate(l.entry_date) })),
    parcels: parcels.rows,
  }
}

/** Bisherige Zeile ab `date` beenden: am selben Tag begonnen → entfernen,
 * sonst Ende auf den Vortag setzen. */
type W = BatchWriter<typeof SYNC_TABLES>

async function closeFrom<T extends 'herd_stays' | 'herd_members' | 'herd_counts'>(
  w: W,
  table: T,
  row: { id: string; from_date: string; to_date: string | null },
  date: string,
) {
  if (row.from_date >= date) await w.softDelete(table, row.id)
  else await w.upsert(table, { ...row, to_date: addDaysIso(date, -1) } as never)
}

export async function saveGroup(group: HerdGroup): Promise<void> {
  await writeBatch((w) => w.upsert('herd_groups', group as never))
}

/** Stall oder Weide einer Gruppe ab `date` wechseln (target null = keine). */
export async function changeStay(
  data: HerdData,
  groupId: string,
  slot: StaySlot,
  target: { location_id: string | null; parcel_id: string | null; day_only?: boolean } | null,
  date: string,
): Promise<void> {
  await writeBatch((w) => changeStayIn(w, data, groupId, slot, target, date))
}

async function changeStayIn(
  w: W,
  data: HerdData,
  groupId: string,
  slot: StaySlot,
  target: { location_id: string | null; parcel_id: string | null; day_only?: boolean } | null,
  date: string,
): Promise<void> {
  for (const s of data.stays.filter((x) => x.group_id === groupId && x.slot === slot && (x.to_date == null || x.to_date >= date))) {
    await closeFrom(w, 'herd_stays', s, date)
  }
  if (!target) return
  await w.upsert('herd_stays', {
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
  await writeBatch((w) => setCountIn(w, data, groupId, category, count, date))
}

async function setCountIn(w: W, data: HerdData, groupId: string, category: string, count: number, date: string): Promise<void> {
  for (const c of data.counts.filter((x) => x.group_id === groupId && x.category === category && (x.to_date == null || x.to_date >= date))) {
    await closeFrom(w, 'herd_counts', c, date)
  }
  if (count > 0) {
    await w.upsert('herd_counts', {
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
  /** ganze Gruppen mitnehmen: alle Einzeltiere (Kategorie bleibt) und alle Anzahlen
   * ohne Nummer; mit `dissolve` wird die Gruppe danach aufgelöst (Stall/Weide enden) */
  groups?: { group: HerdGroup; dissolve: boolean }[]
  dryOff: boolean
}

/** Tiere zügeln: Einzeltiere verlassen ihre bisherige Gruppe (welche auch
 * immer) und kommen ab `date` in die Zielgruppe; Tiere ohne Nummer werden
 * in der Herkunft abgezogen und im Ziel dazugezählt. Optional werden
 * Einzeltiere aus einer gemolkenen Gruppe trockengestellt. */
export async function moveAnimals(data: HerdData, input: MoveInput): Promise<void> {
  await writeBatch((w) => moveIn(w, data, input))
  if (input.dryOff) {
    // Milchschafe/-kühe haben ihre eigene Ablage — eigene Transaktion danach
    const byModule = new Map<string, string[]>()
    for (const a of input.animals) byModule.set(a.moduleKey, [...(byModule.get(a.moduleKey) ?? []), a.id])
    for (const [key, ids] of byModule) {
      await animalProvider(key)?.dryOff?.(ids, input.date, `trockengestellt, gezügelt nach «${input.toGroup.name}»`)
    }
  }
}

async function moveIn(w: W, data: HerdData, input: MoveInput): Promise<void> {
  const { toGroup, fromGroup, date } = input
  const memberRow = (a: { id: string; moduleKey: string; label: string | null }, category: string) => ({
    id: crypto.randomUUID(),
    group_id: toGroup.id,
    module_key: a.moduleKey,
    animal_id: a.id,
    label: a.label,
    category,
    from_date: date,
    to_date: null,
  })
  const moved = new Set<string>()
  for (const a of input.animals) {
    for (const m of data.members.filter((x) => x.animal_id === a.id && (x.to_date == null || x.to_date >= date))) {
      await closeFrom(w, 'herd_members', m, date)
    }
    await w.upsert('herd_members', memberRow(
      { id: a.id, moduleKey: a.moduleKey, label: a.name ? `${a.label} ${a.name}` : a.label },
      input.categories?.[a.id] ?? defaultCategory({ ...a, dry: a.dry || input.dryOff }, toGroup.milking, date),
    ))
    moved.add(a.id)
  }
  // Anzahlen ohne Nummer: je Kategorie einmal setzen (setCountIn liest den alten Stand)
  const add = new Map<string, number>()
  for (const [cat, n] of Object.entries(input.counts)) {
    if (!n) continue
    if (fromGroup) await setCountIn(w, data, fromGroup.id, cat, Math.max(0, countAt(data, fromGroup.id, cat, date) - n), date)
    add.set(cat, (add.get(cat) ?? 0) + n)
  }
  // ganze Gruppen: Einzeltiere mit ihrer Kategorie, alle Anzahlen
  for (const { group, dissolve } of input.groups ?? []) {
    if (group.id === toGroup.id) continue
    const open = <T extends { group_id: string; to_date: string | null }>(r: T) => r.group_id === group.id && (r.to_date == null || r.to_date >= date)
    for (const m of data.members.filter((x) => open(x) && x.from_date <= date)) {
      if (moved.has(m.animal_id)) continue
      await closeFrom(w, 'herd_members', m, date)
      await w.upsert('herd_members', memberRow({ id: m.animal_id, moduleKey: m.module_key, label: m.label }, m.category))
      moved.add(m.animal_id)
    }
    for (const c of data.counts.filter((x) => open(x) && x.from_date <= date)) {
      await closeFrom(w, 'herd_counts', c, date)
      add.set(c.category, (add.get(c.category) ?? 0) + c.count)
    }
    if (dissolve) {
      for (const st of data.stays.filter(open)) await closeFrom(w, 'herd_stays', st, date)
      await w.upsert('herd_groups', { ...group, active: false } as never)
    }
  }
  for (const [cat, n] of add) await setCountIn(w, data, toGroup.id, cat, countAt(data, toGroup.id, cat, date) + n, date)
}

/** Doppelte Zugehörigkeiten bereinigen (herdModel doubleMemberships): die zuletzt
 * begonnene bleibt, die anderen enden am Vortag ihres Beginns. Ein Schritt. */
export async function resolveDoubleMemberships(data: HerdData, date: string): Promise<number> {
  const doubles = doubleMemberships(data.members, date)
  await writeBatch(async (w) => {
    for (const d of doubles) for (const m of d.extra) await closeFrom(w, 'herd_members', m, d.keep.from_date)
  })
  return doubles.length
}

/** Einzeltiere aus der Gruppe nehmen (Abgang, Verkauf …) ab `date`. */
export async function removeMembers(data: HerdData, memberIds: string[], date: string): Promise<void> {
  await writeBatch(async (w) => {
    for (const m of data.members.filter((x) => memberIds.includes(x.id))) await closeFrom(w, 'herd_members', m, date)
  })
}

/** Gruppe ab `date` neu zusammenstellen: die genannten Tiere kommen hinein (und
 * verlassen ihre bisherige Gruppe); mit `replace` verlassen alle anderen
 * Einzeltiere die Gruppe und stehen danach «ohne Gruppe». Tiere ohne Nummer
 * (Anzahlen) bleiben unberührt. Gibt zurück, wie viele dazukamen bzw. gingen. */
export async function constituteGroup(
  data: HerdData,
  input: { group: HerdGroup; animals: AnimalRef[]; date: string; replace: boolean },
): Promise<{ added: number; left: number }> {
  const { group, date } = input
  const ids = new Set(input.animals.map((a) => a.id))
  const inGroup = data.members.filter((m) => m.group_id === group.id && (m.to_date == null || m.to_date >= date))
  const leaving = input.replace ? inGroup.filter((m) => !ids.has(m.animal_id)) : []
  const already = new Set(inGroup.filter((m) => m.from_date <= date).map((m) => m.animal_id))
  const incoming = input.animals.filter((a) => !already.has(a.id))
  await writeBatch(async (w) => {
    // die Gruppe selbst mit (neu oder wieder aktiviert): alles ein Schritt
    await w.upsert('herd_groups', { ...group, active: true } as never)
    for (const m of leaving) await closeFrom(w, 'herd_members', m, date)
    if (incoming.length) await moveIn(w, data, { toGroup: group, fromGroup: null, date, animals: incoming, counts: {}, dryOff: false })
  })
  return { added: incoming.length, left: leaving.length }
}

/** Gruppe ab `date` auflösen: alle Tiere verlassen sie (Einzeltiere → «ohne
 * Gruppe», Anzahlen ohne Nummer enden), Stall und Weide enden, die Gruppe wird
 * inaktiv. Der Verlauf bleibt erhalten; sie lässt sich später wieder aktivieren. */
export async function dissolveGroup(data: HerdData, group: HerdGroup, date: string): Promise<number> {
  const open = <T extends { group_id: string; to_date: string | null }>(r: T) => r.group_id === group.id && (r.to_date == null || r.to_date >= date)
  const members = data.members.filter(open)
  await writeBatch(async (w) => {
    for (const m of members) await closeFrom(w, 'herd_members', m, date)
    for (const c of data.counts.filter(open)) await closeFrom(w, 'herd_counts', c, date)
    for (const st of data.stays.filter(open)) await closeFrom(w, 'herd_stays', st, date)
    await w.upsert('herd_groups', { ...group, active: false } as never)
  })
  return members.length
}

/** Laufhofgang einer Gruppe an `date` setzen oder entfernen. */
export async function setLaufhof(data: HerdData, groupId: string, date: string, on: boolean): Promise<void> {
  const existing = data.laufhof.filter((l) => l.group_id === groupId && l.entry_date === date)
  await writeBatch(async (w) => {
    if (on && existing.length === 0) {
      await w.upsert('herd_laufhof', { id: crypto.randomUUID(), group_id: groupId, entry_date: date, notes: null })
    }
    if (!on) for (const l of existing) await w.softDelete('herd_laufhof', l.id)
  })
}

export async function saveLocation(loc: HerdLocation): Promise<void> {
  await writeBatch((w) => w.upsert('locations', loc as never))
}

/** Standort eines Tiers für das Tierdetail anderer Module (core animals.ts). */
export const herdLocator: HerdLocator = {
  herdsPath: '/tiere',
  async locate(_moduleKey, animalId, date) {
    const data = await loadHerdData()
    return locateAnimal(data, animalId, date)
  },
  async groupNames(animalIds, date) {
    const data = await loadHerdData()
    const ids = new Set(animalIds)
    const names = new Map<string, string>()
    for (const m of data.members) {
      if (!ids.has(m.animal_id) || !activeAt(m, date)) continue
      const g = data.groups.find((x) => x.id === m.group_id)
      if (g) names.set(m.animal_id, g.name)
    }
    return names
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
  await writeBatch((w) => identifyIn(w, data, group, animals, categories, date, reduceCounts))
}

async function identifyIn(
  w: W,
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
    for (const m of open) await closeFrom(w, 'herd_members', m, date)
    const category = categories[a.id] ?? defaultCategory(a, group.milking, date)
    await w.upsert('herd_members', {
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
    if (before > 0) await setCountIn(w, data, group.id, cat, Math.max(0, before - n), date)
  }
}
