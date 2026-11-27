// Übergabe-Checkliste zwischen den Diensten (schema/0016_handover.sql). Ein Punkt gilt für einen bestimmten Dienst
// oder für jeden Dienst einer Tierart; einmalig (der nächste Dienst hakt ab) oder bei jedem Dienst bis zu einem Datum.
// Ziele wie bei den Arbeiten (lib/workTasks.ts), dazu Jungtiere ohne Ohrmarke (provisorische Nummer, Modul Milch).
// Liest und schreibt über die Ablage des Moduls Betrieb, auch wenn die Seite zu einem anderen Modul gehört (Stall).

import type { PGlite } from '@electric-sql/pglite'
import { getCurrentUserEmail } from '@fmis/core/auth'
// mit Sync: wird auch von Seiten anderer Module aufgerufen (Stall, Tierseite)
import { getSyncedDb as getDb } from '../db/access'
import { upsertRow } from '../db/write'
import { isoDate } from './format'
import type { TaskTarget } from './workTasks'

export type HandoverTarget = TaskTarget | { kind: 'jungtier'; module: string; id: string; label: string }

export interface HandoverItem {
  id: string
  text: string
  targets: HandoverTarget[]
  type_id: string | null
  animal: string | null
  from_date: string
  until_date: string | null
  recurring: boolean
  created_by: string | null
  created_at: string
  closed_at: string | null
}

export interface HandoverCheck {
  id: string
  item_id: string
  date: string
  type_id: string | null
  done_by: string | null
  done_at: string
  note: string | null
}

/** Ein Dienst an einem Tag (Platz im Dienstplan oder Diensttyp). */
export interface DutyOccasion {
  date: string
  type: { id: string; animal: string | null }
}

/** Vorlagen für die Schnellwahl. */
export const HANDOVER_TEMPLATES = ['Kontrolle ob saugt', 'Milch mit Flasche geben', 'Fieber messen', 'Nachkontrolle Behandlung', 'Kolostrum geben', 'Einstreu/Box kontrollieren', 'Klauen kontrollieren']

const parse = (v: unknown): HandoverTarget[] => {
  try {
    const t = JSON.parse(String(v ?? '[]')) as HandoverTarget[]
    return Array.isArray(t) ? t : []
  } catch {
    return []
  }
}
const ts = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))

/** Gilt der Punkt für diesen Dienst? */
export function applies(item: Pick<HandoverItem, 'type_id' | 'animal' | 'from_date' | 'until_date' | 'closed_at'>, o: DutyOccasion): boolean {
  if (o.date < item.from_date) return false
  if (item.until_date && o.date > item.until_date) return false
  if (item.type_id) return item.type_id === o.type.id
  return !item.animal || item.animal === o.type.animal
}

/** Abgehakt für diesen Dienst? Einmalige Punkte: ein Haken irgendwann genügt; wiederkehrende: je Tag und Dienst. */
export function checkFor(item: Pick<HandoverItem, 'id' | 'recurring'>, checks: HandoverCheck[], o: DutyOccasion): HandoverCheck | null {
  const mine = checks.filter((c) => c.item_id === item.id)
  if (!item.recurring) return mine[0] ?? null
  return mine.find((c) => c.date === o.date && (c.type_id === o.type.id || c.type_id == null)) ?? null
}

/** Punkte, die für diesen Dienst anstehen (offen oder hier abgehakt), älteste zuerst. */
export function itemsFor(items: HandoverItem[], checks: HandoverCheck[], o: DutyOccasion): { item: HandoverItem; check: HandoverCheck | null }[] {
  return items
    .filter((i) => applies(i, o))
    .map((item) => ({ item, check: checkFor(item, checks, o) }))
    // einmalige, schon früher erledigte Punkte nur zeigen, wenn sie in diesem Dienst abgehakt wurden
    .filter(({ item, check }) => item.recurring || !check || (check.date === o.date && (check.type_id === o.type.id || check.type_id == null)))
    .sort((a, b) => a.item.created_at.localeCompare(b.item.created_at))
}

const toItem = (r: Record<string, unknown>): HandoverItem => ({
  id: String(r.id),
  text: String(r.text),
  targets: parse(r.targets),
  type_id: (r.type_id as string | null) ?? null,
  animal: (r.animal as string | null) ?? null,
  from_date: isoDate(r.from_date),
  until_date: r.until_date ? isoDate(r.until_date) : null,
  recurring: Boolean(r.recurring),
  created_by: (r.created_by as string | null) ?? null,
  created_at: ts(r.created_at) ?? '',
  closed_at: ts(r.closed_at),
})
const toCheck = (r: Record<string, unknown>): HandoverCheck => ({
  id: String(r.id),
  item_id: String(r.item_id),
  date: isoDate(r.date),
  type_id: (r.type_id as string | null) ?? null,
  done_by: (r.done_by as string | null) ?? null,
  done_at: ts(r.done_at) ?? '',
  note: (r.note as string | null) ?? null,
})

/** Offene, nicht abgeschlossene Punkte ab `since` und die Haken der letzten Tage. */
export async function loadHandover(pg?: PGlite, since?: string): Promise<{ items: HandoverItem[]; checks: HandoverCheck[] }> {
  const db = pg ?? (await getDb())
  const [items, checks] = await Promise.all([
    db.query<Record<string, unknown>>('select * from handover_items where deleted_at is null and closed_at is null order by created_at'),
    db.query<Record<string, unknown>>('select * from handover_checks where deleted_at is null and date >= $1', [since ?? '2000-01-01']),
  ])
  return { items: items.rows.map(toItem), checks: checks.rows.map(toCheck) }
}

/** Ein Eintrag im Verlauf: Punkt mit seinen Haken im Zeitraum, beendet oder nicht. */
export interface HandoverHistoryEntry {
  item: HandoverItem
  checks: HandoverCheck[]
  /** zuletzt passiert (Haken oder Beenden), für die Sortierung */
  last: string
}

/** Verlauf ab `since` (Datum): abgehakte und beendete Punkte, samt Bemerkungen; neueste zuerst. */
export function handoverHistory(items: HandoverItem[], checks: HandoverCheck[], since: string): HandoverHistoryEntry[] {
  const out: HandoverHistoryEntry[] = []
  for (const item of items) {
    const mine = checks.filter((c) => c.item_id === item.id && c.date >= since).sort((a, b) => b.done_at.localeCompare(a.done_at))
    const closed = !!item.closed_at && item.closed_at.slice(0, 10) >= since
    if (!mine.length && !closed) continue
    const last = [closed ? item.closed_at! : '', mine[0]?.done_at ?? ''].sort().pop()!
    out.push({ item, checks: mine, last })
  }
  return out.sort((a, b) => b.last.localeCompare(a.last))
}

/** Für den Verlauf: Punkte mit Haken ab `since` oder seit `since` beendet. */
export async function loadHandoverHistory(pg: PGlite, since: string): Promise<HandoverHistoryEntry[]> {
  const [items, checks] = await Promise.all([
    pg.query<Record<string, unknown>>(
      `select * from handover_items where deleted_at is null
         and (closed_at >= $1::date or id in (select item_id from handover_checks where deleted_at is null and date >= $1::date))`,
      [since],
    ),
    pg.query<Record<string, unknown>>('select * from handover_checks where deleted_at is null and date >= $1::date', [since]),
  ])
  return handoverHistory(items.rows.map(toItem), checks.rows.map(toCheck), since)
}

/** Text und Enddatum eines Punkts ändern (Ersteller und Zeitpunkt bleiben). */
export async function updateHandoverItem(item: HandoverItem, change: { text: string; until_date: string | null }): Promise<void> {
  // nur die geänderten Spalten: der Schreibweg ergänzt den Rest aus der bestehenden Zeile
  await upsertRow('handover_items', { id: item.id, text: change.text.trim(), until_date: change.until_date } as never)
}

export async function saveHandoverItem(i: Omit<HandoverItem, 'id' | 'created_by' | 'created_at' | 'closed_at'> & { id?: string }): Promise<void> {
  await upsertRow('handover_items', {
    id: i.id ?? crypto.randomUUID(),
    text: i.text.trim(),
    targets: JSON.stringify(i.targets),
    type_id: i.type_id,
    animal: i.animal,
    from_date: i.from_date,
    until_date: i.until_date,
    recurring: i.recurring,
    created_by: getCurrentUserEmail(),
    created_at: new Date().toISOString(),
    closed_at: null,
    closed_by: null,
    deleted_at: null,
  } as never)
}

/** Abhaken für einen Dienst. */
export async function checkHandover(item: HandoverItem, o: DutyOccasion, note: string | null): Promise<void> {
  await upsertRow('handover_checks', {
    id: crypto.randomUUID(),
    item_id: item.id,
    date: o.date,
    type_id: o.type.id,
    done_by: getCurrentUserEmail(),
    done_at: new Date().toISOString(),
    note: note?.trim() || null,
    deleted_at: null,
  } as never)
}

/** Haken zurücknehmen (falsch angetippt). */
export async function uncheckHandover(check: HandoverCheck): Promise<void> {
  await upsertRow('handover_checks', { ...check, deleted_at: new Date().toISOString() } as never)
}

/** Wiederkehrenden Punkt beenden (z.B. Flasche nicht mehr nötig) oder einmaligen verwerfen. */
export async function closeHandover(item: HandoverItem): Promise<void> {
  await upsertRow('handover_items', { ...item, targets: JSON.stringify(item.targets), closed_at: new Date().toISOString(), closed_by: getCurrentUserEmail() } as never)
}

export const targetText = (ts: HandoverTarget[]) => ts.map((t) => t.label).join(', ')
