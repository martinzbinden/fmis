// Syncbare Tabellen dieses Moduls (gespiegelt in backend/app/tables.py).

export const SYNC_TABLES = {
  machines: [
    'id', 'name', 'kind', 'capacity', 'capacity_unit', 'width_m', 'notes',
    'active', 'sort_order', 'updated_at', 'deleted_at',
    'manufacturer', 'model', 'type_no', 'serial_no', 'year_built', 'weight_kg',
    'power_hp', 'front_pto', 'tractor_id', 'owner', 'category', 'flow_m3_min',
    'settings_def',
  ],
  machine_files: [
    'id', 'machine_id', 'kind', 'title', 'filename', 'content_type',
    'size_bytes', 'source_url', 'sort_order', 'updated_at', 'deleted_at',
  ],
  maintenance_tasks: [
    'id', 'machine_id', 'title', 'task_type', 'interval_count', 'interval_months', 'notes',
    'active', 'sort_order', 'template_key', 'updated_at', 'deleted_at',
  ],
  maintenance_log: [
    'id', 'machine_id', 'done_date', 'entry_type', 'title', 'task_ids', 'counter', 'cost_chf',
    'material', 'done_by', 'notes', 'updated_at', 'deleted_at',
  ],
  machine_todos: [
    'id', 'machine_id', 'title', 'notes', 'priority', 'due_date', 'status', 'done_date',
    'log_id', 'done_log_id', 'created_by', 'updated_at', 'deleted_at',
  ],
  tracks: [
    'id', 'season_year', 'label', 'started_at', 'ended_at', 'width_m',
    'geometry', 'point_times', 'point_count', 'notes', 'created_by',
    'updated_at', 'deleted_at', 'work_type', 'machine', 'operator', 'machine_id',
    'tractor_id', 'guide_ref',
  ],
  machine_settings: [
    'id', 'machine_id', 'track_id', 'set_at', 'settings', 'crop', 'measured_kg_ha', 'notes',
    'created_by', 'updated_at', 'deleted_at',
  ],
  tank_events: [
    'id', 'track_id', 'machine_id', 'parcel_id', 'event_at', 'source', 'volume_m3', 'distance_m',
    'spread_s', 'width_m', 'lat', 'lng', 'notes', 'updated_at', 'deleted_at', 'unit',
  ],
  duty_people: ['id', 'name', 'email', 'color', 'active', 'sort_order', 'notes', 'updated_at', 'deleted_at'],
  duty_types: ['id', 'name', 'start_time', 'duration_min', 'weekdays', 'color', 'description', 'active', 'sort_order', 'updated_at', 'deleted_at'],
  duty_skills: ['id', 'person_id', 'type_id', 'updated_at', 'deleted_at'],
  duty_absences: ['id', 'person_id', 'from_date', 'to_date', 'kind', 'notes', 'created_by', 'updated_at', 'deleted_at'],
  duty_shifts: ['id', 'type_id', 'date', 'slot', 'person_id', 'notes', 'assigned_by', 'updated_at', 'deleted_at'],
  duty_requests: ['id', 'kind', 'person_id', 'shift_id', 'date', 'type_id', 'to_person', 'other_shift_id', 'other_date', 'other_type_id', 'from_date', 'to_date', 'notes', 'status', 'decided_by', 'decided_at', 'decision_note', 'created_by', 'updated_at', 'deleted_at'],
  duty_changes: ['id', 'shift_id', 'date', 'type_id', 'from_person', 'to_person', 'kind', 'changed_by', 'changed_at', 'notes', 'updated_at', 'deleted_at'],
  data_history: [
    'id', 'table_name', 'row_id', 'action', 'changed_by', 'changed_at',
    'snapshot', 'updated_at',
  ],
} as const

export type SyncTable = keyof typeof SYNC_TABLES

// Spalten vom Typ `date` (nicht timestamptz) — der Sync-Client serialisiert sie als YYYY-MM-DD.
export const DATE_ONLY_COLUMNS: Record<SyncTable, Set<string>> = {
  machines: new Set(),
  machine_files: new Set(),
  maintenance_tasks: new Set(),
  maintenance_log: new Set(['done_date']),
  machine_todos: new Set(['due_date', 'done_date']),
  tracks: new Set(),
  tank_events: new Set(),
  machine_settings: new Set(),
  duty_people: new Set(),
  duty_types: new Set(),
  duty_skills: new Set(),
  duty_absences: new Set(['from_date', 'to_date']),
  duty_shifts: new Set(['date']),
  duty_changes: new Set(['date']),
  duty_requests: new Set(['date', 'other_date', 'from_date', 'to_date']),
  data_history: new Set(),
}
