// Syncbare Tabellen und ihre Spalten — Spiegel von backend/app/tables.py
// (SYNC_TABLES). Reihenfolge = Eltern vor Kindern (Pull und Push).

export const SYNC_TABLES = {
  projects: [
    'id', 'name', 'description', 'status', 'location', 'start_date', 'end_date',
    'contractor', 'notes', 'created_by', 'updated_at', 'deleted_at', 'chosen_variant_id',
  ],
  variants: ['id', 'project_id', 'name', 'notes', 'sort_order', 'created_by', 'updated_at', 'deleted_at'],
  features: [
    'id', 'project_id', 'category', 'status', 'label', 'geometry', 'plan_geometry',
    'material', 'diameter_mm', 'depth_cm', 'notes', 'sort_order', 'created_by',
    'updated_at', 'deleted_at', 'variant_id',
  ],
  survey_points: [
    'id', 'project_id', 'feature_id', 'point_no', 'seq', 'lat', 'lng', 'accuracy_m',
    'altitude_m', 'depth_cm', 'note', 'measured_at', 'measured_by', 'updated_at',
    'deleted_at',
  ],
  overlays: [
    'id', 'group_id', 'group_name', 'kind', 'name', 'color', 'south', 'west', 'north', 'east',
    'opacity', 'visible', 'sort_order', 'source', 'size_bytes', 'created_by', 'updated_at',
    'deleted_at',
  ],
  data_history: [
    'id', 'table_name', 'row_id', 'action', 'changed_by', 'changed_at', 'snapshot',
    'updated_at',
  ],
} as const

export type SyncTable = keyof typeof SYNC_TABLES

// Spalten vom SQL-Typ `date` (nicht `timestamptz`) — der Sync-Client
// serialisiert sie als YYYY-MM-DD.
export const DATE_ONLY_COLUMNS: Record<SyncTable, Set<string>> = {
  projects: new Set(['start_date', 'end_date']),
  variants: new Set(),
  features: new Set(),
  survey_points: new Set(),
  overlays: new Set(),
  data_history: new Set(),
}
