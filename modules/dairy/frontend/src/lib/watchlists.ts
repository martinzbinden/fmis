// Merklisten (schema/0019): frei benannte Listen von Tieren, z.B. «Ausmerzen prüfen».

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { softDeleteRow, softDeleteRows, upsertRow, upsertRows } from '../db/write'

export interface Watchlist {
  id: string
  name: string
  color: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  archived_at: string | null
}

export interface WatchlistEntry {
  id: string
  list_id: string
  animal_id: string
  reason: string | null
  added_by: string | null
  added_at: string
  done_at: string | null
}

const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

export async function loadWatchlists(pg: PGlite): Promise<{ lists: Watchlist[]; entries: WatchlistEntry[] }> {
  const [lists, entries] = await Promise.all([
    pg.query<Record<string, unknown>>('select * from watchlists where deleted_at is null order by archived_at nulls first, name'),
    pg.query<Record<string, unknown>>('select * from watchlist_entries where deleted_at is null order by added_at desc'),
  ])
  return {
    lists: lists.rows.map((l) => ({
      id: String(l.id),
      name: String(l.name),
      color: (l.color as string | null) ?? null,
      notes: (l.notes as string | null) ?? null,
      created_by: (l.created_by as string | null) ?? null,
      created_at: ts(l.created_at)!,
      archived_at: ts(l.archived_at),
    })),
    entries: entries.rows.map((e) => ({
      id: String(e.id),
      list_id: String(e.list_id),
      animal_id: String(e.animal_id),
      reason: (e.reason as string | null) ?? null,
      added_by: (e.added_by as string | null) ?? null,
      added_at: ts(e.added_at)!,
      done_at: ts(e.done_at),
    })),
  }
}

export async function createWatchlist(pg: PGlite, name: string): Promise<string> {
  const id = crypto.randomUUID()
  await upsertRow(pg, 'watchlists', {
    id,
    name: name.trim(),
    color: null,
    notes: null,
    created_by: getCurrentUserEmail(),
    created_at: new Date().toISOString(),
    archived_at: null,
  })
  return id
}

export async function saveWatchlist(pg: PGlite, list: Watchlist): Promise<void> {
  await upsertRow(pg, 'watchlists', { ...list })
}

// Speichern je Liste nacheinander: ein doppelter Tipp auf «hinzufügen» startete sonst zwei
// Durchläufe, die beide «noch nicht auf der Liste» sahen und jedes Tier zweimal eintrugen.
const listQueue = new Map<string, Promise<unknown>>()
function serialPerList<T>(listId: string, fn: () => Promise<T>): Promise<T> {
  const next = (listQueue.get(listId) ?? Promise.resolve()).catch(() => undefined).then(fn)
  listQueue.set(listId, next)
  return next
}

/** Tier auf die Liste setzen; steht es schon (offen) darauf, wird nur der Grund ergänzt. */
export function addToWatchlist(pg: PGlite, listId: string, animalIds: string[], reason: string | null): Promise<number> {
  return serialPerList(listId, async () => {
    const { rows } = await pg.query<Record<string, unknown>>(
      'select * from watchlist_entries where list_id = $1 and deleted_at is null and done_at is null',
      [listId],
    )
    const open = new Map(rows.map((r) => [String(r.animal_id), r]))
    const writes: Record<string, unknown>[] = []
    let added = 0
    for (const animalId of new Set(animalIds)) {
      const existing = open.get(animalId)
      if (existing) {
        if (reason && !String(existing.reason ?? '').includes(reason)) {
          writes.push({ ...existing, id: String(existing.id), reason: existing.reason ? `${existing.reason}; ${reason}` : reason })
        }
        continue
      }
      writes.push({
        id: crypto.randomUUID(),
        list_id: listId,
        animal_id: animalId,
        reason,
        added_by: getCurrentUserEmail(),
        added_at: new Date().toISOString(),
        done_at: null,
      })
      added++
    }
    await upsertRows(pg, 'watchlist_entries', writes as never)
    return added
  })
}

/** Doppelte offene Einträge (gleiche Liste, gleiches Tier) — der älteste bleibt und
 * übernimmt allfällige Gründe der anderen. Rein, für removeDuplicateEntries. */
export function duplicateEntries(entries: WatchlistEntry[]): { keep: WatchlistEntry; drop: WatchlistEntry[] }[] {
  const groups = new Map<string, WatchlistEntry[]>()
  for (const e of entries) {
    if (e.done_at) continue
    const k = `${e.list_id}|${e.animal_id}`
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const [first, ...rest] = [...g].sort((a, b) => a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id))
      const reasons = [...new Set(g.flatMap((e) => (e.reason ?? '').split('; ')).filter(Boolean))]
      return { keep: { ...first, reason: reasons.length ? reasons.join('; ') : null }, drop: rest }
    })
}

/** Räumt doppelte Einträge auf (beim Öffnen der Merklisten). Gibt die Anzahl entfernter zurück. */
export async function removeDuplicateEntries(pg: PGlite, entries: WatchlistEntry[]): Promise<number> {
  const dups = duplicateEntries(entries)
  const merged = dups.filter(({ keep }) => entries.find((e) => e.id === keep.id)?.reason !== keep.reason).map(({ keep }) => ({ ...keep }))
  const drop = dups.flatMap(({ drop }) => drop.map((d) => d.id))
  await upsertRows(pg, 'watchlist_entries', merged)
  await softDeleteRows(pg, 'watchlist_entries', drop)
  return drop.length
}

/** Erledigt abhaken (bleibt in der Liste sichtbar) oder wieder öffnen. */
export async function setEntryDone(pg: PGlite, entry: WatchlistEntry, done: boolean): Promise<void> {
  await upsertRow(pg, 'watchlist_entries', { ...entry, done_at: done ? new Date().toISOString() : null })
}

/** Grund bzw. Markierung eines Eintrags ändern (leer = keine). */
export async function setEntryReason(pg: PGlite, entry: WatchlistEntry, reason: string | null): Promise<void> {
  await upsertRow(pg, 'watchlist_entries', { ...entry, reason: reason?.trim() || null })
}

export async function removeEntry(pg: PGlite, entryId: string): Promise<void> {
  await softDeleteRow(pg, 'watchlist_entries', entryId)
}
