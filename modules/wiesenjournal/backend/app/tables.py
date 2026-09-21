# Syncbare Tabellen und ihre Spalten, wie in schema/SYNC_API.md dokumentiert.
# Diese Registry treibt die generischen Sync-Endpunkte (push/pull) an.

SYNC_TABLES: dict[str, list[str]] = {
    "parcels": [
        "id", "season_year", "name", "area_a", "wiesentyp", "intensitaet",
        "base_geometry", "sort_order", "notes", "updated_at", "deleted_at",
        "source", "category", "farm_id", "farm_name", "fields_lineage_id",
        "fields_declaration_id", "external_kultur_id", "kultur_code", "kultur_name_de",
    ],
    "paddocks": [
        "id", "paddock_id", "version_number", "is_current", "parcel_id",
        "season_year", "valid_from", "valid_to", "animal_group", "geometry",
        "notes", "created_by", "updated_at", "deleted_at",
    ],
    "usage_entries": [
        "id", "parcel_id", "entry_date", "usage_type", "animal_count",
        "animal_group", "paddock_version_id", "notes", "updated_at", "deleted_at",
        "animal_category", "day_only", "label", "value_num", "yield_amount",
        "yield_unit", "import_key",
    ],
    "fertilization_entries": [
        "id", "parcel_id", "entry_date", "duengung_code", "amount", "unit",
        "gabe_number", "notes", "updated_at", "deleted_at",
    ],
    "n_dose_summary": [
        "id", "parcel_id", "season_year", "gabe_number", "guelle_verduennung",
        "n_planned_kg", "n_actual_kg", "notes", "updated_at", "deleted_at",
    ],
    "daily_farm_log": [
        "id", "entry_date", "laufhof_kuehe", "laufhof_rinder", "wetter_code",
        "niederschlag_mm", "mond_phase", "notes", "updated_at", "deleted_at",
        "laufhof_kaelber", "laufhof_galtkuehe", "laufhof_schafe", "laufhof_legehennen",
        "animal_counts",
    ],
    "tracks": [
        "id", "season_year", "label", "started_at", "ended_at", "width_m",
        "geometry", "point_times", "point_count", "notes", "created_by",
        "updated_at", "deleted_at",
    ],
    "weed_observations": [
        "id", "season_year", "parcel_id", "track_id", "observed_at",
        "weed_type", "severity", "treatment", "treated_at", "source",
        "geometry", "notes", "created_by", "updated_at", "deleted_at",
    ],
    "data_history": [
        "id", "table_name", "row_id", "action", "changed_by", "changed_at",
        "snapshot", "updated_at",
    ],
}

# Ordnet jede Sync-Tabelle einem Berechtigungsbereich zu (siehe
# core/backend/fmis_core/schema/0002_wiesenjournal_module.sql für die
# Rollen/Permissions). Treibt die Rechteprüfung in sync.py an: push braucht
# "<area>:write", pull liefert eine Tabelle nur mit "<area>:read".
# n_dose_summary teilt sich die Area mit fertilization_entries — beide werden
# in der Praxis immer zusammen bearbeitet (Gaben-Panel).
TABLE_AREA: dict[str, str] = {
    "parcels": "wiesenjournal:parcels",
    "paddocks": "wiesenjournal:weide",
    "usage_entries": "wiesenjournal:nutzung",
    "fertilization_entries": "wiesenjournal:duengung",
    "n_dose_summary": "wiesenjournal:duengung",
    "daily_farm_log": "wiesenjournal:tagesmeldung",
    "tracks": "wiesenjournal:tracking",
    "weed_observations": "wiesenjournal:tracking",
    "data_history": "wiesenjournal:history",
}

# Welche Spalten pro Tabelle echte PostGIS-`geometry`-Spalten sind (seit
# schema/0004_postgis_geometry.sql) statt gewöhnlicher Werte — treibt in
# sync.py die ST_AsGeoJSON/ST_GeomFromGeoJSON-Konvertierung an der Sync-
# Grenze an. Der Client (pglite) sieht davon nichts, er sendet/empfängt
# weiterhin reinen GeoJSON-Text.
GEOMETRY_COLUMNS: dict[str, set[str]] = {
    "parcels": {"base_geometry"},
    "paddocks": {"geometry"},
    "tracks": {"geometry"},
    "weed_observations": {"geometry"},
}
