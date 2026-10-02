// Syncbare Tabellen und ihre Spalten — Spiegel von backend/app/tables.py
// (SYNC_TABLES) und schema/SYNC_API.md. Treibt sowohl den generischen
// upsertRow()-Helfer als auch den Sync-Client an.

export const SYNC_TABLES = {
  animals: [
    'id', 'ear_tag', 'name', 'breed_code', 'birth_date', 'sex', 'status',
    'entry_date', 'exit_date', 'notes', 'updated_at', 'deleted_at', 'lauf_nr',
  ],
  milk_tests: [
    'id', 'animal_id', 'test_date', 'calving_date', 'lactation_number',
    'milk_kg', 'fat_pct', 'protein_pct', 'lactose_pct', 'cell_count',
    'urea_mg_dl', 'updated_at', 'deleted_at',
  ],
  lactations: [
    'id', 'animal_id', 'lactation_number', 'calving_date', 'closure_type',
    'days_in_milk', 'milk_kg', 'fat_kg', 'fat_pct', 'protein_kg',
    'protein_pct', 'updated_at', 'deleted_at',
  ],
  milking_banks: [
    'id', 'session_date', 'bank_number', 'capacity', 'opened_at', 'closed_at',
    'notes', 'updated_at', 'deleted_at',
  ],
  milking_slots: [
    'id', 'bank_id', 'position', 'original_position', 'transponder', 'ear_tag',
    'animal_id', 'weighed', 'notes', 'read_at', 'updated_at', 'deleted_at',
  ],
  animal_journal: [
    'id', 'animal_id', 'entry_date', 'source', 'text', 'ref_id', 'updated_at', 'deleted_at',
  ],
  pedigree: [
    'id', 'animal_key', 'ear_tag', 'sire_key', 'dam_key', 'breed_code', 'name',
    'birth_date', 'sex', 'source', 'updated_at', 'deleted_at',
  ],
  matings: [
    'id', 'animal_id', 'service_date', 'service_to', 'kind', 'seq', 'sire_key',
    'sire_ear_tag', 'sire_name', 'sire_breed', 'source', 'import_key', 'notes',
    'updated_at', 'deleted_at',
  ],
  births: [
    'id', 'dam_id', 'birth_date', 'parity', 'sire_key', 'sire_ear_tag', 'sire_name',
    'ease', 'conception_date', 'source', 'import_key', 'notes', 'updated_at', 'deleted_at',
  ],
  birth_offspring: [
    'id', 'birth_id', 'ear_tag', 'animal_key', 'sex', 'stillborn', 'died_24h',
    'birth_weight_kg', 'import_key', 'updated_at', 'deleted_at',
  ],
  breeding_values: [
    'id', 'animal_id', 'eval_date', 'trait', 'value', 'reliability', 'base',
    'import_key', 'updated_at', 'deleted_at',
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
  lactations: new Set(['calving_date']),
  milking_banks: new Set(['session_date']),
  milking_slots: new Set(),
  animal_journal: new Set(['entry_date']),
  pedigree: new Set(['birth_date']),
  matings: new Set(['service_date', 'service_to']),
  births: new Set(['birth_date', 'conception_date']),
  birth_offspring: new Set(),
  breeding_values: new Set(['eval_date']),
  data_history: new Set(),
}
