// Merklisten (schema/0019): frei benannte Listen von Tieren, z.B. «Ausmerzen prüfen».

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
import { softDeleteRow, upsertRow } from '../db/write'

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

/** Tier auf die Liste setzen; steht es schon (offen) darauf, wird nur der Grund ergänzt. */
export async function addToWatchlist(pg: PGlite, listId: string, animalIds: string[], reason: string | null): Promise<number> {
  const { rows } = await pg.query<Record<string, unknown>>(
    'select * from watchlist_entries where list_id = $1 and deleted_at is null and done_at is null',
    [listId],
  )
  const open = new Map(rows.map((r) => [String(r.animal_id), r]))
  let added = 0
  for (const animalId of animalIds) {
    const existing = open.get(animalId)
    if (existing) {
      if (reason && !String(existing.reason ?? '').includes(reason)) {
        await upsertRow(pg, 'watchlist_entries', { ...existing, id: String(existing.id), reason: existing.reason ? `${existing.reason}; ${reason}` : reason })
      }
      continue
    }
    await upsertRow(pg, 'watchlist_entries', {
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
  return added
}

/** Erledigt abhaken (bleibt in der Liste sichtbar) oder wieder öffnen. */
export async function setEntryDone(pg: PGlite, entry: WatchlistEntry, done: boolean): Promise<void> {
  await upsertRow(pg, 'watchlist_entries', { ...entry, done_at: done ? new Date().toISOString() : null })
}

export async function removeEntry(pg: PGlite, entryId: string): Promise<void> {
  await softDeleteRow(pg, 'watchlist_entries', entryId)
}
