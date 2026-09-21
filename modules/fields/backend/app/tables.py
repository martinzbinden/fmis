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
        "geometry", "source", "notes", "start_date", "end_date", "sorte",
        "updated_at", "deleted_at",
    ],
    "plan_layers": [
        "id", "name", "created_by", "updated_at", "deleted_at",
    ],
    "plan_parcels": [
        "id", "plan_id", "layer_id", "version_number", "is_current", "farm_id",
        "source_declaration_id", "jahr", "kultur_code", "kultur_name_de",
        "kultur_name_fr", "sorte", "flurname", "area_a", "geometry",
        "notes", "created_by", "updated_at", "deleted_at",
    ],
    "data_history": [
        "id", "table_name", "row_id", "action", "changed_by", "changed_at",
        "snapshot", "updated_at",
    ],
}

# Ordnet jede Sync-Tabelle einem Berechtigungsbereich zu (siehe
# core/backend/fmis_core/schema/0001_core.sql für die Rollen/Permissions
# selbst). Treibt die Rechteprüfung in sync.py an: push braucht
# "<area>:write", pull liefert eine Tabelle nur mit "<area>:read".
# Modul-präfixiert (seit dem Merge zu einer App). Beide Betriebe teilen
# sich weiterhin dieselbe Area "fields:fields" (keine getrennten
# Lese-/Schreibrechte je Betrieb, siehe schema/SYNC_API.md).
TABLE_AREA: dict[str, str] = {
    "farms": "fields:fields",
    "management_units": "fields:fields",
    "field_declarations": "fields:fields",
    "plan_layers": "fields:fields",
    "plan_parcels": "fields:fields",
    "data_history": "fields:history",
}

# Welche Spalten pro Tabelle echte PostGIS-`geometry`-Spalten sind (seit
# schema/0007_postgis_geometry.sql) statt gewöhnlicher Werte — treibt in
# sync.py die ST_AsGeoJSON/ST_GeomFromGeoJSON-Konvertierung an der Sync-
# Grenze an. Der Client (pglite) sieht davon nichts, er sendet/empfängt
# weiterhin reinen GeoJSON-Text.
GEOMETRY_COLUMNS: dict[str, set[str]] = {
    "field_declarations": {"geometry"},
    "plan_parcels": {"geometry"},
}
