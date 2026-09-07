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
    "data_history": [
        "id", "table_name", "row_id", "action", "changed_by", "changed_at",
        "snapshot", "updated_at",
    ],
}

# Ordnet jede Sync-Tabelle einem Berechtigungsbereich zu (siehe backend/schema/0001_auth.sql
# für die Rollen/Permissions selbst). Treibt die Rechteprüfung in sync.py an:
# push braucht "<area>:write", pull liefert eine Tabelle nur mit "<area>:read".
TABLE_AREA: dict[str, str] = {
    "animals": "animals",
    "milk_tests": "milk",
    "data_history": "history",
}
