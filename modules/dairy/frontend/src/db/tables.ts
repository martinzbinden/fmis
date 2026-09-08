// Syncbare Tabellen und ihre Spalten — Spiegel von backend/app/tables.py
// (SYNC_TABLES) und schema/SYNC_API.md. Treibt sowohl den generischen
// upsertRow()-Helfer als auch den Sync-Client an.

export const SYNC_TABLES = {
  animals: [
    'id', 'ear_tag', 'name', 'breed_code', 'birth_date', 'sex', 'status',
    'entry_date', 'exit_date', 'notes', 'updated_at', 'deleted_at',
  ],
  milk_tests: [
    'id', 'animal_id', 'test_date', 'calving_date', 'lactation_number',
    'milk_kg', 'fat_pct', 'protein_pct', 'lactose_pct', 'cell_count',
    'urea_mg_dl', 'updated_at', 'deleted_at',
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
  animals: new Set(['birth_date', 'entry_date', 'exit_date']),
  milk_tests: new Set(['test_date', 'calving_date']),
  data_history: new Set(),
}
