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
#
# Als Funktion statt fixem Dict, weil dieses Modul mehrfach instanziert
# werden kann (siehe module_registry.py, ModuleSpec.source) — jede Instanz
# (z.B. "dairy" für Kühe, "dairy_schafe" für Schafe) bekommt ihren eigenen
# Rechte-Prefix, obwohl beide dieselben Tabellen/Spalten verwenden.
def table_area(key: str) -> dict[str, str]:
    return {
        "animals": f"{key}:animals",
        "milk_tests": f"{key}:milk",
        "lactations": f"{key}:milk",
        "data_history": f"{key}:history",
    }
