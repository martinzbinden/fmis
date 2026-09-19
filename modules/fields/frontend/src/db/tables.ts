// Syncbare Tabellen und ihre Spalten — Spiegel von backend/app/tables.py
// (SYNC_TABLES) und schema/SYNC_API.md. Treibt sowohl den generischen
// upsertRow()-Helfer als auch den Sync-Client an.

export const SYNC_TABLES = {
  farms: [
    'id', 'external_uid', 'bur_nr', 'name', 'updated_at', 'deleted_at',
  ],
  management_units: [
    'id', 'farm_id', 'external_id', 'jahr', 'gemeinde_bfs_nr', 'zone',
    'name', 'area_total_a', 'area_unprod_a', 'area_wald_a', 'area_land_a',
    'updated_at', 'deleted_at',
  ],
  field_declarations: [
    'id', 'farm_id', 'lineage_id', 'management_unit_external_id',
    'external_kultur_id', 'jahr', 'sequence_in_year', 'kultur_code',
    'kultur_name_de', 'kultur_name_fr', 'flurname', 'area_a', 'baeume',
    'geometry', 'source', 'notes', 'updated_at', 'deleted_at',
  ],
  data_history: [
    'id', 'table_name', 'row_id', 'action', 'changed_by', 'changed_at',
    'snapshot', 'updated_at',
  ],
} as const

export type SyncTable = keyof typeof SYNC_TABLES

// Spalten vom SQL-Typ `date` (nicht `timestamptz`) — pro Tabelle, damit der
// Sync-Client Date-Objekte, die pglite zurückgibt, korrekt als YYYY-MM-DD statt
// als vollen ISO-Timestamp serialisiert.
export const DATE_ONLY_COLUMNS: Record<SyncTable, Set<string>> = {
  farms: new Set(),
  management_units: new Set(),
  field_declarations: new Set(),
  data_history: new Set(),
}
