# Syncbare Tabellen und ihre Spalten, wie in schema/SYNC_API.md dokumentiert.
# Diese Registry treibt die generischen Sync-Endpunkte (push/pull) an.

SYNC_TABLES: dict[str, list[str]] = {
    "animals": [
        "id", "ear_tag", "name", "breed_code", "birth_date", "sex", "status",
        "entry_date", "exit_date", "notes", "updated_at", "deleted_at",
    ],
    "milk_tests": [
        "id", "animal_id", "test_date", "calving_date", "lactation_number",
        "milk_kg", "fat_pct", "protein_pct", "lactose_pct", "cell_count",
        "urea_mg_dl", "updated_at", "deleted_at",
    ],
    "lactations": [
        "id", "animal_id", "lactation_number", "calving_date", "closure_type",
        "days_in_milk", "milk_kg", "fat_kg", "fat_pct", "protein_kg",
        "protein_pct", "updated_at", "deleted_at",
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
# Modul-präfixiert (seit dem Merge zu einer App) — verhindert, dass z.B.
# "animals:read" mit livestock's gleichnamiger, aber andersartiger Tabelle
# kollidiert.
TABLE_AREA: dict[str, str] = {
    "animals": "dairy:animals",
    "milk_tests": "dairy:milk",
    "lactations": "dairy:milk",
    "data_history": "dairy:history",
}
