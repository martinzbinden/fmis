# Bauprojekte: Leitungen, Schächte und Gebäude planen, einzeichnen, einmessen.

# Reihenfolge = Eltern vor Kindern (Pull wendet in dieser Reihenfolge an;
# der Push sortiert ebenfalls danach, siehe core/frontend/src/sync.ts).
SYNC_TABLES: dict[str, list[str]] = {
    "projects": [
        "id", "name", "description", "status", "location", "start_date", "end_date",
        "contractor", "notes", "created_by", "updated_at", "deleted_at",
    ],
    "features": [
        "id", "project_id", "category", "status", "label", "geometry", "plan_geometry",
        "material", "diameter_mm", "depth_cm", "notes", "sort_order", "created_by",
        "updated_at", "deleted_at",
    ],
    "survey_points": [
        "id", "project_id", "feature_id", "point_no", "seq", "lat", "lng", "accuracy_m",
        "altitude_m", "depth_cm", "note", "measured_at", "measured_by", "updated_at",
        "deleted_at",
    ],
    "data_history": [
        "id", "table_name", "row_id", "action", "changed_by", "changed_at", "snapshot",
        "updated_at",
    ],
}

TABLE_AREA: dict[str, str] = {
    "projects": "bau:projekte",
    "features": "bau:projekte",
    "survey_points": "bau:projekte",
    "data_history": "bau:history",
}

# Echte PostGIS-geometry-Spalten (server/0001_postgis_geometry.sql); der Client
# schickt/erhält reinen GeoJSON-Text.
GEOMETRY_COLUMNS: dict[str, set[str]] = {
    "features": {"geometry", "plan_geometry"},
}
