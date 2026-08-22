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
}
