// Syncbare Tabellen und ihre Spalten — Spiegel von backend/app/tables.py
// (SYNC_TABLES). Treibt sowohl den generischen upsertRow()-Helfer als auch
// den Sync-Client an.

export const SYNC_TABLES = {
  parcels: [
    'id', 'season_year', 'name', 'area_a', 'wiesentyp', 'intensitaet',
    'base_geometry', 'sort_order', 'notes', 'updated_at', 'deleted_at',
    'source', 'category', 'farm_id', 'farm_name', 'fields_lineage_id',
    'fields_declaration_id', 'external_kultur_id', 'kultur_code', 'kultur_name_de',
  ],
  paddocks: [
    'id', 'paddock_id', 'version_number', 'is_current', 'parcel_id',
    'season_year', 'valid_from', 'valid_to', 'animal_group', 'geometry',
    'notes', 'created_by', 'updated_at', 'deleted_at',
  ],
  usage_entries: [
    'id', 'parcel_id', 'entry_date', 'usage_type', 'animal_count',
    'animal_group', 'paddock_version_id', 'notes', 'updated_at', 'deleted_at',
    'animal_category', 'day_only', 'label', 'value_num', 'yield_amount',
    'yield_unit', 'import_key',
  ],
  // fertilizer_types VOR fertilization_entries, fertilization_shares DANACH
  // (Pull wendet Tabellen in dieser Reihenfolge an; shares haben echte FKs).
  fertilizer_types: [
    'id', 'code', 'name', 'unit', 'n_kg_per_unit', 'n_avail_pct',
    'p2o5_kg_per_unit', 'k2o_kg_per_unit', 'mg_kg_per_unit', 'dilution_default',
    'container_label', 'container_size', 'legacy_code', 'sort_order', 'active',
    'notes', 'updated_at', 'deleted_at',
  ],
  fertilization_entries: [
    'id', 'parcel_id', 'entry_date', 'duengung_code', 'amount', 'unit',
    'gabe_number', 'notes', 'updated_at', 'deleted_at',
    'fertilizer_type_id', 'dilution', 'dilution_factor', 'container_count',
    'extent_type', 'track_id', 'track_width_m', 'geometry', 'area_a',
    'n_kg', 'n_avail_kg', 'p2o5_kg', 'k2o_kg', 'import_key',
  ],
  fertilization_shares: [
    'id', 'entry_id', 'parcel_id', 'area_a', 'n_kg', 'n_avail_kg',
    'p2o5_kg', 'k2o_kg', 'updated_at', 'deleted_at',
  ],
  n_dose_summary: [
    'id', 'parcel_id', 'season_year', 'gabe_number', 'guelle_verduennung',
    'n_planned_kg', 'n_actual_kg', 'notes', 'updated_at', 'deleted_at',
  ],
  daily_farm_log: [
    'id', 'entry_date', 'laufhof_kuehe', 'laufhof_rinder', 'wetter_code',
    'niederschlag_mm', 'mond_phase', 'notes', 'updated_at', 'deleted_at',
    'laufhof_kaelber', 'laufhof_galtkuehe', 'laufhof_schafe', 'laufhof_legehennen',
    'animal_counts',
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
  fertilizer_types: new Set(),
  fertilization_entries: new Set(['entry_date']),
  fertilization_shares: new Set(),
  n_dose_summary: new Set(),
  daily_farm_log: new Set(['entry_date']),
  tracks: new Set(),
  weed_observations: new Set(['treated_at']),
  data_history: new Set(),
}
