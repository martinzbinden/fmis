// Gruppen-Auswahl und Mitgliedschaften (group_memberships) — gemeinsam für
// Erfassen-Seiten, Gruppe, Tier und Schlachtung.

import type { PGlite } from '@electric-sql/pglite'
import type { AnimalStatus, GroupMembership, GroupStatus } from '../types'

export interface GroupOption {
  id: string
  name: string
  status: GroupStatus
}

/** Aktive Gruppen; mit `includeId` zusätzlich diese Gruppe, auch wenn sie
 * abgeschlossen ist (Sprung aus der Gruppe mit ?gruppe=<id>, z.B. um Futter
 * nachzutragen). */
export async function loadGroupOptions(pg: PGlite, includeId?: string | null): Promise<GroupOption[]> {
  const { rows } = await pg.query<GroupOption>(
    `select id, name, status from animal_groups
     where deleted_at is null and (status = 'aktiv' or id = $1)
     order by created_date desc`,
    [includeId || null],
  )
  return rows
}

/** Anzeigename in Auswahllisten: abgeschlossene Gruppen sichtbar markiert. */
export function groupOptionLabel(g: GroupOption): string {
  return g.status === 'aktiv' ? g.name : `${g.name} (abgeschlossen)`
}

/** Status, bei denen ein Tier die Gruppe verlässt. */
export const LEAVING_STATUSES: readonly AnimalStatus[] = ['verkauft', 'geschlachtet', 'verendet']

/** pglite liefert date-Spalten je nach Weg als Date oder als Text. */
export function isoDay(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v ?? '').slice(0, 10)
}

/** Offene Mitgliedschaften mit Enddatum beenden. Ein Enddatum vor dem Start
 * wird auf den Start gesetzt, damit keine negative Dauer entsteht. Gibt nur
 * die geänderten Zeilen zurück (volle Zeilen, weil upsert alle Spalten
 * schreibt). */
export function closeMemberships(rows: GroupMembership[], endDate: string): GroupMembership[] {
  return rows
    .filter((m) => !m.deleted_at && !m.end_date)
    .map((m) => {
      const start = isoDay(m.start_date)
      return { ...m, end_date: endDate < start ? start : endDate }
    })
}

/** Alle offenen Mitgliedschaften eines Tiers (volle Zeilen). */
export async function loadOpenMemberships(pg: PGlite, animalId: string): Promise<GroupMembership[]> {
  const { rows } = await pg.query<GroupMembership>(
    'select * from group_memberships where animal_id = $1 and deleted_at is null and end_date is null',
    [animalId],
  )
  return rows
}

export interface AnimalDependents {
  weighings: number
  medications: number
  slaughter: number
}

export async function countAnimalDependents(pg: PGlite, animalId: string): Promise<AnimalDependents> {
  const { rows } = await pg.query<{ w: number; m: number; s: number }>(
    `select
       (select count(*) from weighings where animal_id = $1 and deleted_at is null)::int as w,
       (select count(*) from medications where animal_id = $1 and deleted_at is null)::int as m,
       (select count(*) from slaughter_results where animal_id = $1 and deleted_at is null)::int as s`,
    [animalId],
  )
  const r = rows[0]
  return { weighings: Number(r?.w ?? 0), medications: Number(r?.m ?? 0), slaughter: Number(r?.s ?? 0) }
}

export interface GroupDependents {
  feed: number
  expenses: number
  memberships: number
}

export async function countGroupDependents(pg: PGlite, groupId: string): Promise<GroupDependents> {
  const { rows } = await pg.query<{ f: number; e: number; g: number }>(
    `select
       (select count(*) from feed_records where group_id = $1 and deleted_at is null)::int as f,
       (select count(*) from expenses where group_id = $1 and deleted_at is null)::int as e,
       (select count(*) from group_memberships where group_id = $1 and deleted_at is null)::int as g`,
    [groupId],
  )
  const r = rows[0]
  return { feed: Number(r?.f ?? 0), expenses: Number(r?.e ?? 0), memberships: Number(r?.g ?? 0) }
}

/** Meldung, warum sich ein Tier nicht löschen lässt; null = löschbar. */
export function animalDeleteBlocker(d: AnimalDependents): string | null {
  const parts = [
    d.weighings && `${d.weighings} Wägung(en)`,
    d.medications && `${d.medications} Medikament(e)`,
    d.slaughter && `${d.slaughter} Schlachtresultat`,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return `Dieses Tier hat ${parts.join(', ')}. Löschen würde diese Einträge verwaisen lassen. Setze stattdessen den Status (verkauft, geschlachtet, verendet).`
}

/** Meldung, warum sich eine Gruppe nicht löschen lässt; null = löschbar. */
export function groupDeleteBlocker(d: GroupDependents): string | null {
  const parts = [
    d.feed && `${d.feed} Futtereintrag/-einträge`,
    d.expenses && `${d.expenses} Kosteneintrag/-einträge`,
    d.memberships && `${d.memberships} Mitgliedschaft(en)`,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return `Diese Gruppe hat ${parts.join(', ')}. Löschen würde diese Einträge verwaisen lassen. Setze die Gruppe stattdessen auf «abgeschlossen» (Gruppendaten → Stift).`
}
