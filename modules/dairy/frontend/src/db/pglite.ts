import { PGlite } from '@electric-sql/pglite'

// Alle schema/*.sql-Dateien werden zur Build-Zeit als Rohtext eingebettet und
// in Dateinamen-Reihenfolge als Migrationen angewendet — spiegelbildlich zum
// Migration-Runner in backend/app/db.py (`run_migrations`). So bleibt das
// clientseitige pglite-Schema immer 1:1 identisch zum Server-Postgres-Schema.
const migrationModules = import.meta.glob('../../../schema/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

interface Migration {
  version: string
  sql: string
}

const migrations: Migration[] = Object.entries(migrationModules)
  .map(([path, sql]) => ({ version: path.split('/').pop()!, sql }))
  .sort((a, b) => a.version.localeCompare(b.version))

async function runMigrations(pg: PGlite): Promise<void> {
  await pg.exec(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  const { rows } = await pg.query<{ version: string }>(
    'select version from schema_migrations',
  )
  const applied = new Set(rows.map((r) => r.version))

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    await pg.transaction(async (tx) => {
      await tx.exec(migration.sql)
      await tx.query('insert into schema_migrations (version) values ($1)', [
        migration.version,
      ])
    })
  }
}

// Ein Promise pro Instanz-Key (z.B. "dairy" für Kühe, "dairy_schafe" für
// Schafe) — dieses Modul kann mehrfach instanziert werden (siehe
// core/backend/fmis_core/module_registry.py, ModuleSpec.source), jede
// Instanz braucht ihre eigene, unabhängige IndexedDB.
const dbPromises = new Map<string, Promise<PGlite>>()

/**
 * Key-gecachter Zugriff auf die lokale pglite-Instanz EINER Modul-Instanz.
 * pglite ist die einzige Datenquelle für die UI — das Backend wird nur für
 * /auth, /sync/push und /sync/pull kontaktiert (siehe schema/SYNC_API.md).
 */
export function getDb(key: string): Promise<PGlite> {
  let dbPromise = dbPromises.get(key)
  if (!dbPromise) {
    dbPromise = (async () => {
      const pg = new PGlite(`idb://${key}`)
      await runMigrations(pg)
      return pg
    })()
    dbPromises.set(key, dbPromise)
  }
  return dbPromise
}
