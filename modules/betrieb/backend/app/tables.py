# Betrieb: Maschinen, Wartung, Pendenzen, GPS-Spuren, Güllefass-Ereignisse, Dienstplan.

SYNC_TABLES: dict[str, list[str]] = {
    "machines": [
        "id", "name", "kind", "capacity", "capacity_unit", "width_m", "notes", "active",
        "sort_order", "updated_at", "deleted_at", "manufacturer", "model", "type_no", "serial_no",
        "year_built", "weight_kg", "power_hp", "front_pto", "tractor_id", "owner", "category",
        "flow_m3_min", "settings_def",
    ],
    "machine_files": [
        "id", "machine_id", "kind", "title", "filename", "content_type", "size_bytes",
        "source_url", "sort_order", "updated_at", "deleted_at",
    ],
    "maintenance_tasks": [
        "id", "machine_id", "title", "task_type", "interval_count", "interval_months", "notes",
        "active", "sort_order", "template_key", "updated_at", "deleted_at",
    ],
    "maintenance_log": [
        "id", "machine_id", "done_date", "entry_type", "title", "task_ids", "counter", "cost_chf",
        "material", "done_by", "notes", "updated_at", "deleted_at",
    ],
    "machine_todos": [
        "id", "machine_id", "title", "notes", "priority", "due_date", "status", "done_date",
        "log_id", "done_log_id", "created_by", "updated_at", "deleted_at",
    ],
    "tracks": [
        "id", "season_year", "label", "started_at", "ended_at", "width_m", "geometry",
        "point_times", "point_count", "notes", "created_by", "updated_at", "deleted_at",
        "work_type", "machine", "operator", "machine_id", "tractor_id", "guide_ref",
    ],
    "machine_settings": [
        "id", "machine_id", "track_id", "set_at", "settings", "crop", "measured_kg_ha", "notes",
        "created_by", "updated_at", "deleted_at",
    ],
    "tank_events": [
        "id", "track_id", "machine_id", "parcel_id", "event_at", "source", "volume_m3",
        "distance_m", "spread_s", "width_m", "lat", "lng", "notes", "updated_at", "deleted_at",
        "unit",
    ],
    "duty_people": [
        "id", "name", "email", "color", "active", "sort_order", "notes", "updated_at",
        "deleted_at",
    ],
    "duty_types": [
        "id", "name", "start_time", "duration_min", "weekdays", "color", "description", "active",
        "sort_order", "updated_at", "deleted_at", "animal", "active_from", "active_to",
        "summer_from", "summer_to", "times",
    ],
    "duty_skills": [
        "id", "person_id", "type_id", "updated_at", "deleted_at",
    ],
    "duty_absences": [
        "id", "person_id", "from_date", "to_date", "kind", "notes", "created_by", "updated_at",
        "deleted_at",
    ],
    "duty_shifts": [
        "id", "type_id", "date", "slot", "person_id", "notes", "assigned_by", "updated_at",
        "deleted_at",
    ],
    "duty_changes": [
        "id", "shift_id", "date", "type_id", "from_person", "to_person", "kind", "changed_by",
        "changed_at", "notes", "updated_at", "deleted_at",
    ],
    "duty_templates": [
        "id", "name", "valid_from", "cycle_weeks", "notes", "updated_at", "deleted_at",
    ],
    "duty_template_slots": [
        "id", "template_id", "week_no", "weekday", "type_id", "slot", "person_id", "updated_at",
        "deleted_at",
    ],
    "duty_weeks": [
        "id", "week_start", "status", "generated_at", "confirmed_by", "confirmed_at", "notes",
        "updated_at", "deleted_at",
    ],
    "duty_requests": [
        "id", "kind", "person_id", "shift_id", "date", "type_id", "to_person", "other_shift_id",
        "other_date", "other_type_id", "from_date", "to_date", "notes", "status", "decided_by", "decided_at", "decision_note",
        "created_by", "updated_at", "deleted_at",
    ],
    "data_history": [
        "id", "table_name", "row_id", "action", "changed_by", "changed_at", "snapshot",
        "updated_at",
    ],
}

# Berechtigungsbereich je Tabelle (siehe wiesenjournal/backend/app/tables.py)
TABLE_AREA: dict[str, str] = {
    "machines": "betrieb:tracking",
    "machine_files": "betrieb:tracking",
    "maintenance_tasks": "betrieb:tracking",
    "maintenance_log": "betrieb:tracking",
    "machine_todos": "betrieb:tracking",
    "tracks": "betrieb:tracking",
    "tank_events": "betrieb:tracking",
    "machine_settings": "betrieb:tracking",
    "duty_people": "betrieb:dienste",
    "duty_types": "betrieb:dienste",
    "duty_skills": "betrieb:dienste",
    "duty_absences": "betrieb:dienste",
    "duty_shifts": "betrieb:dienste",
    "duty_changes": "betrieb:dienste",
    # Wünsche/Vorschläge: eigener Bereich, damit Mitarbeitende nur dort schreiben
    # (Prüfung der Zeilen: sync.py _guard)
    "duty_requests": "betrieb:wuensche",
    # Standardpläne und Wochenstatus führt das Büro; Mitarbeit liest (betrieb:dienste:read)
    "duty_templates": "betrieb:dienste",
    "duty_template_slots": "betrieb:dienste",
    "duty_weeks": "betrieb:dienste",
    "data_history": "betrieb:history",
}

# PostGIS-Spalten (Server), siehe schema/server/
GEOMETRY_COLUMNS: dict[str, set[str]] = {
    "tracks": {"geometry"},
}

# Erfassungen mit Korrekturfrist (core/backend/fmis_core/sync_push.py): wer das Recht
# «core:korrektur:write» nicht hat (Rolle Mitarbeit), ändert oder storniert sie nur
# in den ersten 10 Minuten nach dem Eintrag. Bewusst nur einmalige Einträge, nicht
# Stammdaten und nicht Zeilen, die im Alltag laufend nachgeführt werden (Tagesmeldung,
# Wägesitzung, Spuren, Behandlungsjournal).
FRIST_TABLES: set[str] = {"maintenance_log"}
