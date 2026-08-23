# Syncbare Tabellen und ihre Spalten, wie in schema/SYNC_API.md dokumentiert.
# Diese Registry treibt die generischen Sync-Endpunkte (push/pull) an.

SYNC_TABLES: dict[str, list[str]] = {
    "animals": [
        "id", "ear_tag", "birth_date", "sex", "status", "entry_date",
        "entry_weight_kg", "purchase_cost", "source_tvd_nr", "source_name",
        "notes", "updated_at", "deleted_at",
    ],
    "animal_groups": [
        "id", "name", "created_date", "target_weight_min_kg", "target_weight_max_kg",
        "status", "notes", "updated_at", "deleted_at",
    ],
    "group_memberships": [
        "id", "animal_id", "group_id", "start_date", "end_date", "updated_at", "deleted_at",
    ],
    "weighings": [
        "id", "animal_id", "date", "weight_kg", "notes", "updated_at", "deleted_at",
    ],
    "medications": [
        "id", "animal_id", "date", "medication_name", "dose", "reason",
        "withdrawal_days", "administered_by", "cost", "updated_at", "deleted_at",
    ],
    "feed_records": [
        "id", "group_id", "date", "feed_type", "quantity", "unit", "cost_total",
        "supplier", "notes", "updated_at", "deleted_at",
    ],
    "expenses": [
        "id", "group_id", "date", "category", "description", "amount", "updated_at", "deleted_at",
    ],
    "slaughter_results": [
        "id", "animal_id", "slaughter_date", "slaughterhouse", "carcass_weight_kg",
        "classification", "fat_class", "price_per_kg", "total_revenue", "notes",
        "updated_at", "deleted_at",
    ],
    "data_history": [
        "id", "table_name", "row_id", "action", "changed_by", "changed_at",
        "snapshot", "updated_at",
    ],
    "medication_reference": [
        "id", "name", "active_ingredient", "default_withdrawal_days", "notes",
        "verified_at", "updated_at", "deleted_at",
    ],
    "feed_reference": [
        "id", "name", "supplier", "crude_protein_pct", "energy_mj",
        "crude_fiber_pct", "crude_ash_pct", "crude_fat_pct", "calcium_pct",
        "phosphorus_pct", "sodium_pct", "notes", "verified_at", "updated_at",
        "deleted_at",
    ],
}

# Ordnet jede Sync-Tabelle einem Berechtigungsbereich zu (siehe backend/schema/0001_auth.sql
# für die Rollen/Permissions selbst). Treibt die Rechteprüfung in sync.py an:
# push braucht "<area>:write", pull liefert eine Tabelle nur mit "<area>:read".
TABLE_AREA: dict[str, str] = {
    "animals": "animals",
    "animal_groups": "groups",
    "group_memberships": "groups",
    "weighings": "weighings",
    "medications": "medications",
    "feed_records": "feed",
    "expenses": "expenses",
    "slaughter_results": "slaughter",
    "data_history": "history",
    "medication_reference": "medications",
    "feed_reference": "feed",
}
