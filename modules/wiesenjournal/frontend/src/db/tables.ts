// Syncbare Tabellen und ihre Spalten — Spiegel von backend/app/tables.py
// (SYNC_TABLES). Treibt sowohl den generischen upsertRow()-Helfer als auch
// den Sync-Client an.

export const SYNC_TABLES = {
  parcels: [
    'id', 'season_year', 'name', 'area_a', 'wiesentyp', 'intensitaet',
    'base_geometry', 'sort_order', 'notes', 'updated_at', 'deleted_at',
  ],
  paddocks: [
    'id', 'paddock_id', 'version_number', 'is_current', 'parcel_id',
    'season_year', 'valid_from', 'valid_to', 'animal_group', 'geometry',
    'notes', 'created_by', 'updated_at', 'deleted_at',
  ],
  usage_entries: [
    'id', 'parcel_id', 'entry_date', 'usage_type', 'animal_count',
    'animal_group', 'paddock_version_id', 'notes', 'updated_at', 'deleted_at',
  ],
  fertilization_entries: [
    'id', 'parcel_id', 'entry_date', 'duengung_code', 'amount', 'unit',
    'gabe_number', 'notes', 'updated_at', 'deleted_at',
  ],
  n_dose_summary: [
    'id', 'parcel_id', 'season_year', 'gabe_number', 'guelle_verduennung',
    'n_planned_kg', 'n_actual_kg', 'notes', 'updated_at', 'deleted_at',
  ],
  daily_farm_log: [
    'id', 'entry_date', 'laufhof_kuehe', 'laufhof_rinder', 'wetter_code',
    'niederschlag_mm', 'mond_phase', 'notes', 'updated_at', 'deleted_at',
  ],
  tracks: [
    'id', 'season_year', 'label', 'started_at', 'ended_at', 'width_m',
    'geometry', 'point_times', 'point_count', 'notes', 'created_by',
    'updated_at', 'deleted_at',
  ],
  weed_observations: [
    'id', 'season_year', 'parcel_id', 'track_id', 'observed_at',
    'weed_type', 'severity', 'treatment', 'treated_at', 'source',
    'geometry', 'notes', 'created_by', 'updated_at', 'deleted_at',
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
  parcels: new Set(),
  paddocks: new Set(['valid_from', 'valid_to']),
  usage_entries: new Set(['entry_date']),
  fertilization_entries: new Set(['entry_date']),
  n_dose_summary: new Set(),
  daily_farm_log: new Set(['entry_date']),
  tracks: new Set(),
  weed_observations: new Set(['treated_at']),
  data_history: new Set(),
}
