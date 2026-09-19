# Syncbare Tabellen und ihre Spalten, wie in schema/SYNC_API.md dokumentiert.
# Diese Registry treibt die generischen Sync-Endpunkte (push/pull) an.

SYNC_TABLES: dict[str, list[str]] = {
    "farms": [
        "id", "external_uid", "bur_nr", "name", "updated_at", "deleted_at",
    ],
    "management_units": [
        "id", "farm_id", "external_id", "jahr", "gemeinde_bfs_nr", "zone",
        "name", "area_total_a", "area_unprod_a", "area_wald_a", "area_land_a",
        "updated_at", "deleted_at",
    ],
    "field_declarations": [
        "id", "farm_id", "lineage_id", "management_unit_external_id",
        "external_kultur_id", "jahr", "sequence_in_year", "kultur_code",
        "kultur_name_de", "kultur_name_fr", "flurname", "area_a", "baeume",
        "geometry", "source", "notes", "updated_at", "deleted_at",
    ],
    "data_history": [
        "id", "table_name", "row_id", "action", "changed_by", "changed_at",
        "snapshot", "updated_at",
    ],
}

# Ordnet jede Sync-Tabelle einem Berechtigungsbereich zu (siehe backend/schema/0001_auth.sql
# für die Rollen/Permissions selbst). Treibt die Rechteprüfung in sync.py an:
# push braucht "<area>:write", pull liefert eine Tabelle nur mit "<area>:read".
# Beide Betriebe teilen sich dieselbe Area "fields" (keine getrennten
# Lese-/Schreibrechte je Betrieb, siehe schema/SYNC_API.md).
TABLE_AREA: dict[str, str] = {
    "farms": "fields",
    "management_units": "fields",
    "field_declarations": "fields",
    "data_history": "history",
}
