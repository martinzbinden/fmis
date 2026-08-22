# Sync-API-Kontrakt

Das Backend ist bewusst dünn: Auth + Sync-Relay + dauerhafte Speicherung.
Sämtliche CRUD-Logik, Formulare und die Wirtschaftlichkeits-Views laufen im
Frontend direkt gegen pglite (identisches Schema wie `schema/0001_init.sql`,
inkl. der Views). Der Server wird nur für Push/Pull kontaktiert.

## Syncbare Tabellen und Spaltenreihenfolge

Diese Reihenfolge ist verbindlich für Push-Payloads (Backend validiert per Name, Reihenfolge ist nur Doku):

- `animals`: id, ear_tag, birth_date, sex, status, entry_date, entry_weight_kg, purchase_cost, source_tvd_nr, source_name, notes, updated_at, deleted_at
- `animal_groups`: id, name, created_date, target_weight_min_kg, target_weight_max_kg, status, notes, updated_at, deleted_at
- `group_memberships`: id, animal_id, group_id, start_date, end_date, updated_at, deleted_at
- `weighings`: id, animal_id, date, weight_kg, notes, updated_at, deleted_at
- `medications`: id, animal_id, date, medication_name, dose, reason, withdrawal_days, administered_by, cost, updated_at, deleted_at
- `feed_records`: id, group_id, date, feed_type, quantity, unit, cost_total, supplier, notes, updated_at, deleted_at
- `expenses`: id, group_id, date, category, description, amount, updated_at, deleted_at
- `slaughter_results`: id, animal_id, slaughter_date, slaughterhouse, carcass_weight_kg, classification, fat_class, price_per_kg, total_revenue, notes, updated_at, deleted_at

Views (`v_animal_group_days`, `v_group_costs`, `v_animal_economics`) werden NICHT
gesynct — sie werden lokal in pglite genau wie auf dem Server aus den Basistabellen
berechnet, da beide dasselbe Schema inkl. Views laden.

## Auth

`POST /auth/login`
Request: `{"password": "..."}`
Response 200: `{"access_token": "...", "token_type": "bearer"}`
Response 401: falsches Passwort

Alle `/sync/*`-Endpunkte erfordern `Authorization: Bearer <token>`.

## Push

`POST /sync/push`
Request:
```json
{
  "tables": {
    "animals": [ { "id": "...", "ear_tag": "...", "...": "...", "updated_at": "2026-08-17T10:00:00Z", "deleted_at": null } ],
    "weighings": [ ... ]
  }
}
```
Jede Zeile muss alle Spalten der Tabelle enthalten (fehlende Spalten werden als `null`
behandelt, ausser NOT NULL-Spalten ohne Default — dort muss der Client immer einen Wert senden).

Server-Verhalten: pro Zeile `INSERT ... ON CONFLICT (id) DO UPDATE SET ... WHERE
{table}.updated_at < EXCLUDED.updated_at` (last-write-wins über `updated_at`).

Response 200: `{"accepted": {"animals": 3, "weighings": 12, ...}}`

## Pull

`GET /sync/pull?since=<ISO-8601 timestamp oder leer für Vollsync>`

Response 200:
```json
{
  "server_time": "2026-08-22T09:00:00Z",
  "tables": {
    "animals": [ ... Zeilen mit updated_at > since ... ],
    "weighings": [ ... ]
  }
}
```
Client speichert `server_time` als neuen `since`-Wasserstand für den nächsten Pull
(vermeidet Uhr-Drift zwischen Client und Server). Bei leerem `since` werden alle
nicht-gelöschten UND gelöschten Zeilen zurückgegeben (Client muss `deleted_at`
selbst lokal anwenden, auch beim ersten Vollsync gibt es i.d.R. keine).

## Health

`GET /health` → `{"status": "ok"}`, kein Auth nötig.
