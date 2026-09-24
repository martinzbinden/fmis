import type { PGlite } from '@electric-sql/pglite'
import { getModuleDb, type Migration } from '@fmis/core/db'
import { SYNC_TABLES } from './tables'

// Alle schema/*.sql-Dateien werden zur Build-Zeit als Rohtext eingebettet und
// in Dateinamen-Reihenfolge als Migrationen angewendet — spiegelbildlich zum
// Migration-Runner in backend/app/db.py (`run_migrations`). So bleibt das
// clientseitige pglite-Schema immer 1:1 identisch zum Server-Postgres-Schema.
const migrationModules = import.meta.glob('../../../schema/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const migrations: Migration[] = Object.entries(migrationModules)
  .map(([path, sql]) => ({ version: path.split('/').pop()!, sql }))
  .sort((a, b) => a.version.localeCompare(b.version))

// Ein Promise pro Instanz-Key (z.B. "dairy" für Kühe, "dairy_schafe" für
// Schafe) — dieses Modul kann mehrfach instanziert werden (siehe
// core/backend/fmis_core/module_registry.py, ModuleSpec.source), jede
// Instanz bekommt ihr eigenes Postgres-Schema in der gemeinsamen pglite-
// Datenbank (siehe core/frontend/src/db.ts).
const dbPromises = new Map<string, Promise<PGlite>>()

/**
 * Key-gecachter Zugriff auf das Schema EINER Modul-Instanz. pglite ist die
 * einzige Datenquelle für die UI — das Backend wird nur für /auth,
 * /sync/push und /sync/pull kontaktiert (siehe schema/SYNC_API.md).
 */
export function getDb(key: string): Promise<PGlite> {
  let dbPromise = dbPromises.get(key)
  if (!dbPromise) {
    dbPromise = getModuleDb({
      schema: key,
      legacyIdbName: key,
      migrations,
      syncTables: SYNC_TABLES,
    })
    dbPromises.set(key, dbPromise)
  }
  return dbPromise
}
