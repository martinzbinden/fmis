# Tiere: Herdengruppen, Standorte, Aufenthalte, Mitglieder, Bestände, Laufhof.

SYNC_TABLES: dict[str, list[str]] = {
    "locations": [
        "id", "name", "site", "kind", "sort_order", "active", "notes", "updated_at", "deleted_at",
        "laufhof",
    ],
    "herd_groups": [
        "id", "name", "species", "milking", "active", "sort_order", "notes", "updated_at",
        "deleted_at",
    ],
    "herd_stays": [
        "id", "group_id", "slot", "location_id", "parcel_id", "day_only", "from_date", "to_date",
        "notes", "updated_at", "deleted_at",
    ],
    "herd_members": [
        "id", "group_id", "module_key", "animal_id", "label", "category", "from_date", "to_date",
        "updated_at", "deleted_at",
    ],
    "herd_counts": [
        "id", "group_id", "category", "count", "from_date", "to_date", "notes", "updated_at",
        "deleted_at",
    ],
    "herd_laufhof": [
        "id", "group_id", "entry_date", "notes", "updated_at", "deleted_at",
    ],
    "data_history": [
        "id", "table_name", "row_id", "action", "changed_by", "changed_at", "snapshot",
        "updated_at",
    ],
}

# Berechtigungsbereich je Tabelle (siehe wiesenjournal/backend/app/tables.py)
TABLE_AREA: dict[str, str] = {
    "locations": "tiere:herden",
    "herd_groups": "tiere:herden",
    "herd_stays": "tiere:herden",
    "herd_members": "tiere:herden",
    "herd_counts": "tiere:herden",
    "herd_laufhof": "tiere:herden",
    "data_history": "tiere:history",
}

# PostGIS-Spalten (Server), siehe schema/server/
GEOMETRY_COLUMNS: dict[str, set[str]] = {
}
