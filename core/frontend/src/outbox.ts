// Outbox-Verwaltung für den Push (core/frontend/src/sync.ts).
//
// Eine Zeile bleibt in der Outbox, bis der Server genau DEN Stand
// quittiert hat, der gesendet wurde: upsertRow() überschreibt den
// Outbox-Eintrag bei jeder Änderung mit dem neuen updated_at. Wurde eine
// Zeile also während des Sendens nochmals gespeichert, passt der Stempel
// nicht mehr, und der Eintrag bleibt für den nächsten Push stehen. Früher
// wurde nur nach (Tabelle, id) gelöscht — die neueste Fassung blieb dann nur
// auf dem Gerät, bis die Zeile irgendwann nochmals geändert wurde.

import type { PGlite } from '@electric-sql/pglite'

export interface OutboxEntry {
  table: string
  id: string
  /** updated_at als Postgres-Text (volle Mikrosekunden, verlustfrei) */
  stamp: string
}

export interface RejectedRow {
  table: string
  id: string
  reason: 'forbidden' | 'invalid' | 'unknown_table' | 'frist' | string
  detail: string
  /** Stand des Servers bei reason 'frist': die lokale Änderung wird damit überschrieben */
  current?: Record<string, unknown> | null
}

export async function readOutbox(pg: PGlite): Promise<OutboxEntry[]> {
  const { rows } = await pg.query<{ table_name: string; row_id: string; stamp: string }>(
    'select table_name, row_id, updated_at::text as stamp from sync_outbox',
  )
  return rows.map((r) => ({ table: r.table_name, id: r.row_id, stamp: r.stamp }))
}

/** Gesendete Einträge entfernen — ausser abgelehnte und solche, die seit dem
 * Lesen der Outbox erneut geändert wurden. Gibt die Anzahl entfernter
 * Einträge zurück. Eine einzige Abfrage (pglite schreibt jede Query einzeln
 * nach IndexedDB). */
export async function clearSent(pg: PGlite, sent: OutboxEntry[], rejected: RejectedRow[] = []): Promise<number> {
  const bad = new Set(rejected.map((r) => `${r.table}\u0000${r.id}`))
  const ok = sent.filter((e) => !bad.has(`${e.table}\u0000${e.id}`))
  if (ok.length === 0) return 0
  const res = await pg.query(
    `delete from sync_outbox o
     using unnest($1::text[], $2::uuid[], $3::text[]) as s(t, i, u)
     where o.table_name = s.t and o.row_id = s.i and o.updated_at = s.u::timestamptz`,
    [ok.map((e) => e.table), ok.map((e) => e.id), ok.map((e) => e.stamp)],
  )
  return res.affectedRows ?? 0
}

/** Abgelehnte Änderungen nach Ablauf der Korrekturfrist zurücknehmen: der Stand
 * des Servers überschreibt die Zeile auf dem Gerät (unabhängig vom Zeitstempel,
 * die lokale Fassung ist ja neuer) und der Outbox-Eintrag entfällt. Sonst
 * würde das Gerät dieselbe Änderung jede Minute erneut senden und die Zeile
 * bliebe lokal anders als auf dem Server. Gibt die zurückgenommenen Zeilen zurück. */
export async function revertRejected(
  pg: PGlite,
  rejected: RejectedRow[],
  syncTables: Record<string, readonly string[]>,
): Promise<RejectedRow[]> {
  const reverted: RejectedRow[] = []
  for (const r of rejected) {
    const columns = syncTables[r.table]
    if (r.reason !== 'frist' || !r.current || !columns) continue
    const colList = columns.map((c) => `"${c}"`).join(', ')
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
    const setClause = columns
      .filter((c) => c !== 'id')
      .map((c) => `"${c}" = excluded."${c}"`)
      .join(', ')
    await pg.query(
      `insert into "${r.table}" (${colList}) values (${placeholders})
       on conflict (id) do update set ${setClause}`,
      columns.map((c) => r.current![c] ?? null),
    )
    await pg.query('delete from sync_outbox where table_name = $1 and row_id = $2', [r.table, r.id])
    reverted.push(r)
  }
  return reverted
}

/** Meldung für die Statusanzeige (SyncStatusDot) bei abgelehnten Zeilen. */
export function describeRejected(rejected: RejectedRow[]): string {
  const first = rejected[0]
  const n = rejected.length
  const what = first.reason === 'forbidden' ? 'fehlendes Schreibrecht' : first.detail
  if (first.reason === 'frist') return `${first.detail} — die Änderung wurde zurückgenommen (${first.table}).`
  return `${n} ${n === 1 ? 'Eintrag wurde' : 'Einträge wurden'} vom Server abgelehnt — alle anderen Änderungen sind gesichert. ${first.table}: ${what}`
}
