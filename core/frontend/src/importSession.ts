// Importe laufen gegen den SERVERSTAND, nicht gegen die lokale Kopie des
// Geräts: eine Import-Sitzung lädt den vollständigen Stand eines Moduls vom
// Server in eine flüchtige pglite-Datenbank im Arbeitsspeicher (gleiche
// Migrationen wie lokal), die bestehenden Import-Funktionen schreiben dort
// hinein (inkl. Outbox und data_history), und commit() schickt alle
// Änderungen in EINEM Push an den Server — der schreibt sie in einer
// Transaktion (backend sync.py: eine Verbindung, ein commit). Danach holt
// das Gerät sie mit dem normalen Sync-Pull.
//
// Vorteile gegenüber dem Schreiben in die lokale Datenbank: ein Gerät mit
// unvollständigem oder veraltetem Stand legt nichts doppelt an, es geht
// schnell (Arbeitsspeicher statt IndexedDB), und ein Import kommt ganz oder
// gar nicht an. Braucht eine Verbindung zum Server.

import { PGlite } from '@electric-sql/pglite'
import { API_URL, getToken } from './auth'
import type { Migration } from './db'
import type { SyncClient } from './sync'

export interface ImportSession {
  /** Flüchtige Datenbank mit dem Serverstand — wie die lokale zu benutzen. */
  pg: PGlite
  /** Alle bisherigen Änderungen an den Server schicken; gibt die Anzahl Zeilen zurück. */
  commit(): Promise<number>
  close(): Promise<void>
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function formatValue(value: unknown, dateOnly: boolean): unknown {
  if (value instanceof Date) {
    const iso = value.toISOString()
    return dateOnly ? iso.slice(0, 10) : iso
  }
  return value
}

export async function openImportSession(opts: {
  moduleKey: string
  migrations: Migration[]
  syncTables: Record<string, readonly string[]>
  dateOnlyColumns: Record<string, ReadonlySet<string>>
  ensureOutbox: (pg: PGlite) => Promise<void>
  /** Sync-Client des Moduls: vorher lokale Änderungen hochladen, nachher den Import holen. */
  sync: SyncClient
  /** Lokale Datenbank des Moduls — nur um ungesendete Änderungen zu erkennen. */
  localDb: () => Promise<PGlite>
  /** Fortschritt beim Laden des Serverstands (0..1), für die Upload-Seite. */
  onProgress?: (step: string, fraction: number) => void
}): Promise<ImportSession> {
  const base = `${API_URL}/${opts.moduleKey}/sync`

  // 1. Ungesendete lokale Änderungen zuerst hochladen — sonst könnte der
  //    Import auf einem älteren Stand derselben Zeilen aufsetzen.
  opts.onProgress?.('Lokale Änderungen hochladen', 0)
  await opts.sync.syncNow()
  const local = await opts.localDb()
  await opts.ensureOutbox(local)
  const { rows: pending } = await local.query<{ n: number }>('select count(*)::int as n from sync_outbox')
  if (pending[0]?.n) {
    throw new Error(
      `Auf diesem Gerät sind noch ${pending[0].n} Änderungen nicht beim Server. Bitte mit Internet synchronisieren (Punkt oben rechts) und dann erneut importieren.`,
    )
  }

  // 2. Serverstand holen.
  opts.onProgress?.('Serverstand laden', 0.1)
  let res: Response
  try {
    res = await fetch(new URL(`${base}/pull`, window.location.origin).toString(), { headers: authHeaders() })
  } catch {
    throw new Error('Importe brauchen eine Verbindung zum Server.')
  }
  if (!res.ok) throw new Error(`Serverstand konnte nicht geladen werden (${res.status}) — Import abgebrochen.`)
  const data = (await res.json()) as { tables: Record<string, Record<string, unknown>[]> }

  // 3. Flüchtige Datenbank: Schema wie lokal, Serverstand ohne Outbox laden.
  opts.onProgress?.('Serverstand übernehmen', 0.4)
  const total = Object.keys(opts.syncTables).reduce((s, t) => s + (data.tables[t]?.length ?? 0), 0)
  let loaded = 0
  const pg = new PGlite()
  for (const m of opts.migrations) await pg.exec(m.sql)
  await opts.ensureOutbox(pg)
  await pg.transaction(async (tx) => {
    // Fremdschlüssel beim Laden nicht prüfen: der Server ist konsistent, die
    // Reihenfolge der Tabellen im Pull ist es nicht zwingend.
    await tx.exec('set local session_replication_role = replica')
    for (const [table, columns] of Object.entries(opts.syncTables)) {
      const rows = data.tables[table]
      if (!rows?.length) continue
      const colList = columns.map((c) => `"${c}"`).join(', ')
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
      for (const row of rows) {
        await tx.query(
          `insert into "${table}" (${colList}) values (${placeholders}) on conflict (id) do nothing`,
          columns.map((c) => row[c] ?? null),
        )
        if (++loaded % 200 === 0) opts.onProgress?.('Serverstand übernehmen', 0.4 + (0.6 * loaded) / total)
      }
    }
  })
  opts.onProgress?.('Serverstand übernehmen', 1)

  async function commit(): Promise<number> {
    const { rows: outbox } = await pg.query<{ table_name: string; row_id: string }>('select table_name, row_id from sync_outbox')
    if (outbox.length === 0) return 0
    const byTable = new Map<string, string[]>()
    for (const r of outbox) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r.row_id])

    // In der Reihenfolge der Tabellenliste (Eltern vor Kindern) — der Server
    // prüft Fremdschlüssel sofort.
    const payload: Record<string, Record<string, unknown>[]> = {}
    for (const [table, columns] of Object.entries(opts.syncTables)) {
      const ids = byTable.get(table)
      if (!ids) continue
      const dateOnly = opts.dateOnlyColumns[table] ?? new Set<string>()
      const colList = columns.map((c) => `"${c}"`).join(', ')
      const { rows } = await pg.query<Record<string, unknown>>(`select ${colList} from "${table}" where id = any($1::uuid[])`, [ids])
      payload[table] = rows.map((row) => Object.fromEntries(columns.map((c) => [c, formatValue(row[c], dateOnly.has(c))])))
    }
    const push = await fetch(`${base}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ tables: payload }),
    })
    if (!push.ok) throw new Error(`Import konnte nicht gespeichert werden (Server ${push.status}) — es wurde nichts übernommen.`)
    await pg.exec('delete from sync_outbox')
    // Das Gerät holt den Import mit dem normalen Abgleich.
    await opts.sync.syncNow()
    return outbox.filter((r) => r.table_name !== 'data_history').length
  }

  return { pg, commit, close: () => pg.close() }
}
