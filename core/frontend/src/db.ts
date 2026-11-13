import { PGlite } from '@electric-sql/pglite'
import { createReadDeduper, queryKey } from './queryDedupe'

// Aus der PGlite-Klasse abgeleitet statt eines eigenen Imports von 'Transaction'
// — die Bibliothek exportiert diesen Typ nicht unter garantiertem Namen, ihre
// tatsächliche Instanzmethode tut es aber immer.
type PgTransactionCallback = Parameters<PGlite['transaction']>[0]
type PgTx = Parameters<PgTransactionCallback>[0]

export interface Migration {
  version: string
  sql: string
}

// Schreibvorgänge warten, bis der Speicher in IndexedDB steht (siehe relaxedDurability oben). Mehrere
// gleichzeitige Schreibvorgänge teilen sich das Wegschreiben: eines läuft, ein weiteres folgt danach.
let flushFn: (() => Promise<void>) | null = null
let flushRunning: Promise<void> | null = null
let flushQueued: Promise<void> | null = null
export function flushNow(): Promise<void> {
  if (!flushFn) return Promise.resolve()
  if (!flushRunning) {
    const p = flushFn().finally(() => {
      flushRunning = null
    })
    flushRunning = p
    return p
  }
  // läuft schon eines: danach noch eines (deckt Änderungen ab, die nach dessen Beginn kamen)
  if (!flushQueued) {
    flushQueued = flushRunning
      .catch(() => undefined)
      .then(() => {
        flushQueued = null
        return flushNow()
      })
  }
  return flushQueued
}
const WRITES = /^\s*(insert|update|delete|create|alter|drop|truncate|merge|copy)\b|^\s*with\b[\s\S]*\b(insert|update|delete)\b/i
async function durably<T>(isWrite: boolean, run: () => Promise<T>): Promise<T> {
  const result = await run()
  if (isWrite) await flushNow()
  return result
}

/**
 * EINE PGlite/IndexedDB für die ganze App statt vorher einer pro Modul-
 * INSTANZ (dairy, dairy_schafe, fields, livestock, wiesenjournal — je ~10 MB
 * Grundkosten für eine eigene Postgres-WASM-Laufzeit). Genau wie auf dem
 * Server (core/backend/fmis_core/db.py: EINE Postgres-Datenbank, EIN
 * Schema pro Modul-Instanz) bekommt hier jedes Modul über getModuleDb()
 * unten ein eigenes Postgres-SCHEMA innerhalb dieser einen Datenbank.
 */
let sharedDbPromise: Promise<PGlite> | null = null
function getSharedDb(): Promise<PGlite> {
  if (!sharedDbPromise) {
    // relaxedDurability: Ohne diese Einstellung wartet jede Abfrage (auch ein reines Lesen) darauf, dass
    // PGlite seinen Speicher in IndexedDB zurückschreibt: ~65–100 ms je Abfrage, auch bei «select 1» —
    // eine Seite mit 25 Abfragen brauchte so mehrere Sekunden. Mit ihr kehrt die Abfrage sofort zurück
    // (< 1 ms), das Wegschreiben läuft im Hintergrund. SCHREIBEN wartet trotzdem darauf (flushNow unten):
    // «Gespeichert» heisst gespeichert, auch wenn die Seite gleich danach geschlossen wird.
    const pg = new PGlite('idb://fmis', { relaxedDurability: true })
    flushFn = () => pg.fs?.syncToFs(false) ?? Promise.resolve()
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushNow().catch(() => undefined))
    window.addEventListener('pagehide', () => void flushNow().catch(() => undefined))
    sharedDbPromise = Promise.resolve(pg)
  }
  return sharedDbPromise
}

const scopedByKey = new Map<string, PGlite>()
const schemaByClient = new WeakMap<object, string>()

/** Schema (= Modul-Instanz, z.B. "dairy_schafe") eines Clients aus getModuleDb —
 * für «Rückgängig» (core/undo.ts), damit Schritte ihrem Modul zugeordnet sind. */
export function schemaOf(pg: object): string | undefined {
  return schemaByClient.get(pg)
}

// Protokoll langsamer Abfragen zur Fehlersuche («die App ist träge»): in der Konsole des Browsers
// `localStorage.fmis_slowlog = '1'` setzen und neu laden; danach zeigt `window.__slowq` Wartezeit
// (in der einzigen Warteschlange der Verbindung) und Laufzeit je Abfrage. Aus = kein Mehraufwand.
const SLOW_MS = 40
let slowLogOn: boolean | null = null
const slowLogEnabled = () => {
  if (slowLogOn == null) {
    try {
      slowLogOn = localStorage.getItem('fmis_slowlog') === '1'
    } catch {
      slowLogOn = false
    }
  }
  return slowLogOn
}
async function timed<T>(schema: string, sql: string, run: () => Promise<T>): Promise<T> {
  if (!slowLogEnabled()) return run()
  const queued = performance.now()
  try {
    return await run()
  } finally {
    const total = Math.round(performance.now() - queued)
    if (total >= SLOW_MS) {
      const w = window as unknown as { __slowq?: { at: number; schema: string; ms: number; sql: string }[] }
      ;(w.__slowq ??= []).push({ at: Math.round(queued), schema, ms: total, sql: sql.replace(/\s+/g, ' ').slice(0, 120) })
    }
  }
}

/**
 * Isolierter "Schema-Client" für EIN Modul (bzw. eine Modul-Instanz wie
 * "dairy_schafe") — verhält sich für den Rest der App (write.ts, useQuery,
 * sync.ts, alle Seiten) exakt wie eine eigenständige PGlite-Instanz mit
 * eigenem, leerem Schema.
 *
 * Warum nicht einmalig `SET search_path` setzen und gut ist? Weil mehrere
 * Module GLEICHZEITIG im Hintergrund syncen können, sobald man mehr als
 * eines besucht hat — ModuleRoute (frontend/src/App.tsx) startet den
 * Sync-Loop eines Moduls beim ersten Besuch und stoppt ihn nie wieder, auch
 * nach dem Verlassen der Route. Auf EINER gemeinsamen Verbindung wäre ein
 * global gesetzter search_path also eine Wettlaufsituation zwischen den
 * Modulen — ein Pull für "dairy" könnte mitten in einem Schreibvorgang für
 * "wiesenjournal" laufen und in dessen Tabellen landen.
 *
 * `SET LOCAL search_path` löst das: es gilt nur innerhalb der EINEN
 * Transaktion, in der es gesetzt wird. pglite hat dazu nur eine einzige,
 * serialisierte Verbindung (kein Verbindungspool, keine echte Parallelität)
 * — jeder query()/exec()/transaction()-Aufruf läuft vollständig zu Ende,
 * bevor der nächste beginnt. Ein Aufruf für Schema A kann sich also nie mit
 * einem für Schema B verschränken, weil jeder sein eigenes `SET LOCAL`
 * innerhalb seiner eigenen, abgeschlossenen Transaktion mitbringt.
 */
function scopeToSchema(pg: PGlite, schema: string): PGlite {
  const cached = scopedByKey.get(schema)
  if (cached) return cached

  const setPath = `set local search_path to "${schema}", public`
  // eine Ausführung je gleichzeitige identische Lese-Abfrage; jeder Schreibvorgang leert sie
  const reads = createReadDeduper<Awaited<ReturnType<PGlite['query']>>>()

  const scoped = {
    query: (query: string, params?: unknown[], options?: unknown) => {
      const write = WRITES.test(query)
      const run = () =>
        durably(write, () =>
          timed(schema, query, () =>
            pg.transaction(async (tx: PgTx) => {
              await tx.exec(setPath)
              return tx.query(query, params as never, options as never)
            }),
          ),
        )
      if (write) {
        reads.invalidate()
        return run()
      }
      // Lesen: gleichzeitige identische Abfragen teilen sich eine Ausführung (queryDedupe.ts).
      // Abfragen mit eigenen Optionen (z.B. Parser) laufen immer einzeln.
      return options ? run() : reads.read(queryKey(schema, query, params), run)
    },
    exec: (query: string, options?: unknown) => {
      reads.invalidate()
      return durably(WRITES.test(query) || /;\s*\S/.test(query), () =>
        timed(schema, query, () =>
          pg.transaction(async (tx: PgTx) => {
            await tx.exec(setPath)
            return tx.exec(query, options as never)
          }),
        ),
      )
    },
    // Gruppen von Schreibvorgängen (inTransaction): nach dem Abschluss wegschreiben
    transaction: <T>(callback: (tx: PgTx) => Promise<T>) => {
      reads.invalidate()
      return durably(true, () =>
        pg.transaction(async (tx: PgTx) => {
          await tx.exec(setPath)
          return callback(tx)
        }),
      )
    },
  }

  const typed = scoped as unknown as PGlite
  if (slowLogEnabled()) ((window as unknown as { __db?: Record<string, PGlite> }).__db ??= {})[schema] = typed
  scopedByKey.set(schema, typed)
  schemaByClient.set(typed, schema)
  return typed
}

async function runMigrations(pg: PGlite, migrations: Migration[]): Promise<void> {
  await pg.exec(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const { rows } = await pg.query<{ version: string }>('select version from schema_migrations')
  const applied = new Set(rows.map((r) => r.version))

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    await pg.transaction(async (tx) => {
      await tx.exec(migration.sql)
      await tx.query('insert into schema_migrations (version) values ($1)', [migration.version])
    })
  }
}

/**
 * Übernimmt, was auf diesem Gerät noch lokal war, aber den Server nie
 * erreicht hat, aus der ALTEN, separaten IndexedDB dieses Moduls (vor dem
 * Umstieg auf eine gemeinsame Datenbank) — sonst gingen Wägungen/Einträge,
 * die z.B. offline im Stall erfasst und noch nicht hochgeladen wurden,
 * beim Umstieg stillschweigend verloren.
 *
 * Alles ANDERE (bereits synchronisierte Daten) wird bewusst NICHT kopiert:
 * der erzwungene Voll-Pull direkt nach diesem Umstieg (siehe sync.ts,
 * schemaSignature) holt es ohnehin frisch vom Server — günstiger und
 * verlässlicher als ein Kopieren tausender Zeilen im Browser.
 */
async function migrateLegacyOutbox(
  scoped: PGlite,
  legacyIdbName: string,
  schema: string,
  syncTables: Record<string, readonly string[]>,
): Promise<void> {
  const marker = `fmis_legacy_migrated_${schema}`
  try {
    if (localStorage.getItem(marker) === '1') return
  } catch {
    // Ohne localStorage kein Marker möglich — unten läuft es dann bei jedem
    // Start erneut, was harmlos ist (ON CONFLICT macht es wiederholbar).
  }

  // Harte Frist statt eines einfachen try/catch: das Öffnen einer IndexedDB
  // kann nicht nur fehlschlagen, sondern auch ENDLOS HÄNGEN, ohne jemals
  // Fehler oder Erfolg zu melden — z.B. wenn dieselbe Datenbank in einem
  // ANDEREN, noch offenen Tab desselben Browsers gerade in Benutzung ist
  // (beim Testen reproduziert: ein liegen gelassener alter Tab hat jeden
  // erneuten Öffnen-Versuch unbegrenzt blockiert). Ohne diese Frist würde
  // ein einziges betroffenes Gerät die App für immer auf "Datenbank wird
  // initialisiert…" stehen lassen — schlimmer als der Datenverlust, den
  // diese Funktion eigentlich verhindern soll. Bei Ablauf bleibt der Marker
  // unten ungesetzt (Neuversuch beim nächsten Start), die App startet aber
  // sofort weiter.
  let timedOut = false
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => {
      timedOut = true
      resolve()
    }, 8000)
  })

  const attempt = (async () => {
    // ERST prüfen, ob die alte Datenbank überhaupt existiert, OHNE sie zu
    // öffnen: `new PGlite(...)` legt bei einem noch nicht existierenden
    // Namen sofort ein vollständiges, leeres Postgres-Datenverzeichnis an
    // (in der Praxis fast so gross wie eine echte, befüllte Instanz — genau
    // die Speicherkosten, die dieser ganze Umstieg vermeiden soll). Auf
    // einem neuen Gerät (oder für ein Modul, das hier nie besucht wurde)
    // gibt es den alten Namen nicht — dann gar nicht erst öffnen.
    // indexedDB.databases() fehlt in sehr alten Browsern; dann lieber wie
    // bisher direkt versuchen, als ein Gerät ganz von der Übernahme
    // auszuschliessen.
    if (typeof indexedDB.databases === 'function') {
      const existing = await indexedDB.databases()
      if (!existing.some((d) => d.name === `/pglite/${legacyIdbName}`)) {
        try {
          localStorage.setItem(marker, '1')
        } catch {
          /* siehe oben */
        }
        return
      }
    }

    let legacy: PGlite | null = null
    try {
      legacy = new PGlite(`idb://${legacyIdbName}`)
      const outbox = await legacy.query<{ table_name: string; row_id: string; updated_at: string }>(
        `select table_name, row_id, updated_at from sync_outbox`,
      )

    if (outbox.rows.length > 0) {
      await scoped.exec(`
        create table if not exists sync_outbox (
          table_name text not null,
          row_id uuid not null,
          updated_at timestamptz not null default now(),
          primary key (table_name, row_id)
        )
      `)

      const byTable = new Map<string, string[]>()
      for (const row of outbox.rows) {
        const ids = byTable.get(row.table_name) ?? []
        ids.push(row.row_id)
        byTable.set(row.table_name, ids)
      }

      for (const [table, ids] of byTable) {
        const columns = syncTables[table]
        if (!columns) continue // Tabelle, die es im neuen Schema (mehr) so nicht gibt
        const colList = columns.map((c) => `"${c}"`).join(', ')
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        const setClause = columns
          .filter((c) => c !== 'id')
          .map((c) => `"${c}" = excluded."${c}"`)
          .join(', ')
        const { rows } = await legacy.query<Record<string, unknown>>(
          `select ${colList} from "${table}" where id = any($1::uuid[])`,
          [ids],
        )
        if (rows.length > 0) {
          await scoped.transaction(async (tx) => {
            for (const row of rows) {
              const values = columns.map((c) => row[c] ?? null)
              await tx.query(
                `insert into "${table}" (${colList}) values (${placeholders})
                 on conflict (id) do update set ${setClause}
                 where "${table}".updated_at < excluded.updated_at`,
                values,
              )
            }
          })
        }
      }

      await scoped.transaction(async (tx) => {
        for (const row of outbox.rows) {
          await tx.query(
            `insert into sync_outbox (table_name, row_id, updated_at) values ($1, $2, $3)
             on conflict (table_name, row_id) do update set updated_at = excluded.updated_at`,
            [row.table_name, row.row_id, row.updated_at],
          )
        }
      })
    }

      try {
        localStorage.setItem(marker, '1')
      } catch {
        /* siehe oben */
      }
    } catch (err) {
      // Alte Datenbank existierte nicht, war leer, oder liess sich nicht
      // lesen — kein Grund, den App-Start zu blockieren. Ohne Marker wird es
      // beim nächsten Start erneut versucht.
      console.warn(`Übernahme der alten lokalen Datenbank (${legacyIdbName}) übersprungen`, err)
    } finally {
      if (legacy) await legacy.close().catch(() => {})
    }
  })()

  await Promise.race([attempt, timeout])
  if (timedOut) {
    console.warn(
      `Übernahme der alten lokalen Datenbank (${legacyIdbName}) dauerte zu lange — App startet ohne sie weiter.`,
    )
  }
}

/**
 * Liefert die pglite-"Instanz" für EIN Modul-Schema, inkl. Migrationen und
 * Übernahme noch nicht hochgeladener Altdaten. Wird von jedem
 * modules/<name>/frontend/src/db/pglite.ts als getDb() exportiert — dort
 * pro Modul-Instanz-Key gecacht, damit dies nur einmal läuft.
 */
export async function getModuleDb(opts: {
  /** Server-identischer Schema-Name, z.B. "dairy_schafe" (siehe
   *  core/backend/fmis_core/module_registry.py, ModuleSpec.key). */
  schema: string
  /** idb://-Name der alten, separaten Datenbank vor diesem Umstieg. */
  legacyIdbName: string
  migrations: Migration[]
  syncTables: Record<string, readonly string[]>
}): Promise<PGlite> {
  const pg = await getSharedDb()
  // Muss auf der ROHEN (nicht gescopten) Verbindung laufen: das Schema
  // existiert beim allerersten Aufruf noch nicht — "set search_path" darauf
  // würde scheitern, solange es nicht angelegt ist.
  await pg.exec(`create schema if not exists "${opts.schema}"`)
  const scoped = scopeToSchema(pg, opts.schema)
  await runMigrations(scoped, opts.migrations)
  await migrateLegacyOutbox(scoped, opts.legacyIdbName, opts.schema, opts.syncTables)
  return scoped
}

/**
 * Rein lesender, schema-qualifizierter Zugriff auf ein ANDERES Moduls
 * Tabellen über dieselbe gemeinsame Verbindung — z.B. wiesenjournal, das die
 * Parzellen von fields als Kartenhintergrund zeigen will (siehe
 * modules/wiesenjournal/frontend/src/lib/fieldsBackground.ts). Klappt nur,
 * wenn dieses Schema in diesem Browser schon existiert (das andere Modul
 * also schon mal besucht/migriert wurde) — sonst wirft die Abfrage, was der
 * Aufrufer als "nicht verfügbar" behandeln sollte, nicht als harten Fehler.
 */
export async function getSharedDbRaw(): Promise<PGlite> {
  return getSharedDb()
}
