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

let dbPromise: Promise<PGlite> | null = null

/**
 * Zugriff auf das "wiesenjournal"-Schema in der gemeinsamen pglite-Datenbank
 * (siehe core/frontend/src/db.ts) — für den Rest der App unverändert eine
 * eigenständige PGlite-Instanz. pglite ist die einzige Datenquelle für die
 * UI — das Backend wird nur für /auth, /sync/push und /sync/pull kontaktiert.
 */
export function getDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = getModuleDb({
      schema: 'wiesenjournal',
      legacyIdbName: 'wiesenjournal',
      migrations,
      syncTables: SYNC_TABLES,
    })
  }
  return dbPromise
}
