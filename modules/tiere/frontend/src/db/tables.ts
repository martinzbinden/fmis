// Syncbare Tabellen dieses Moduls (gespiegelt in backend/app/tables.py).

export const SYNC_TABLES = {
  locations: ['id', 'name', 'site', 'kind', 'sort_order', 'active', 'notes', 'updated_at', 'deleted_at', 'laufhof'],
  herd_groups: ['id', 'name', 'species', 'milking', 'active', 'sort_order', 'notes', 'updated_at', 'deleted_at'],
  herd_stays: [
    'id', 'group_id', 'slot', 'location_id', 'parcel_id', 'day_only', 'from_date', 'to_date',
    'notes', 'updated_at', 'deleted_at',
  ],
  herd_members: [
    'id', 'group_id', 'module_key', 'animal_id', 'label', 'category', 'from_date', 'to_date',
    'updated_at', 'deleted_at',
  ],
  herd_counts: ['id', 'group_id', 'category', 'count', 'from_date', 'to_date', 'notes', 'updated_at', 'deleted_at'],
  herd_laufhof: ['id', 'group_id', 'entry_date', 'notes', 'updated_at', 'deleted_at'],
  data_history: [
    'id', 'table_name', 'row_id', 'action', 'changed_by', 'changed_at',
    'snapshot', 'updated_at',
  ],
} as const

export type SyncTable = keyof typeof SYNC_TABLES

// Spalten vom Typ `date` (nicht timestamptz) — der Sync-Client serialisiert sie als YYYY-MM-DD.
export const DATE_ONLY_COLUMNS: Record<SyncTable, Set<string>> = {
  locations: new Set(),
  herd_groups: new Set(),
  herd_stays: new Set(['from_date', 'to_date']),
  herd_members: new Set(['from_date', 'to_date']),
  herd_counts: new Set(['from_date', 'to_date']),
  herd_laufhof: new Set(['entry_date']),
  data_history: new Set(),
}
