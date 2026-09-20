# Sync-API-Kontrakt

Das Backend ist bewusst dünn: Auth + Sync-Relay + dauerhafte Speicherung.
Sämtliche CRUD-Logik und Auswertungen laufen im Frontend direkt gegen
pglite (identisches Schema wie `schema/0001_init.sql`, inkl. der Views).
Der Server wird nur für Push/Pull kontaktiert.

Anders als bei `modules/dairy`/`modules/livestock` teilen sich hier **zwei
Betriebe** (Betriebszweiggemeinschaft/ÖLN-Gemeinschaft) eine Datenbank —
jede Zeile ist über `farm_id` eindeutig einem Betrieb zugeordnet, Login und
Berechtigungen sind aber gemeinsam (ein Sync-Endpunkt für beide).

## Syncbare Tabellen und Spaltenreihenfolge

Diese Reihenfolge ist verbindlich für Push-Payloads (Backend validiert per Name, Reihenfolge ist nur Doku):

- `farms`: id, external_uid, bur_nr, name, updated_at, deleted_at
- `management_units`: id, farm_id, external_id, jahr, gemeinde_bfs_nr, zone, name, area_total_a, area_unprod_a, area_wald_a, area_land_a, updated_at, deleted_at
- `field_declarations`: id, farm_id, lineage_id, management_unit_external_id, external_kultur_id, jahr, sequence_in_year, kultur_code, kultur_name_de, kultur_name_fr, flurname, area_a, baeume, geometry, source, notes, updated_at, deleted_at
- `data_history`: id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at — Audit-Log, wird
  ausschliesslich automatisch von `upsertRow()`/`softDeleteRow()` befüllt (siehe `frontend/src/db/write.ts`),
  nie direkt von einem Formular. Kein `deleted_at` (unveränderlich). `snapshot` ist die komplette Zeile NACH
  der Änderung als JSON-Text.

View (`v_field_lineage_summary`) wird NICHT gesynct — sie wird lokal in
pglite genau wie auf dem Server aus den Basistabellen berechnet, da beide
dasselbe Schema inkl. Views laden.

## Auth

E-Mail-Magic-Link statt Passwort — siehe `backend/schema/0001_auth.sql` für
das Nutzer/Rollen-Modell (nicht Teil dieses geteilten Schemas, rein
serverseitig).

`POST /auth/request-link {"email": "..."}` → immer 200, generische Antwort.
`POST /auth/verify {"token": "..."}` → `{"access_token": "...", "token_type": "bearer"}`
(401 falls ungültig/abgelaufen/durch neueren Link ersetzt, 403 falls Konto
noch nicht freigeschaltet). Der Link ist persistent (`SESSION_TTL_DAYS`,
mehrfach verwendbar, kein Verbrauch bei `verify`) — nur ein neu angeforderter
Link invalidiert den alten. `GET /auth/me` → aktuelle Rolle + Permissions.

Alle `/sync/*`-Endpunkte erfordern `Authorization: Bearer <token>`.

## Push

`POST /sync/push`
Request:
```json
{
  "tables": {
    "farms": [ { "id": "...", "name": "...", "...": "...", "updated_at": "2026-09-19T10:00:00Z", "deleted_at": null } ],
    "field_declarations": [ ... ]
  }
}
```
Jede Zeile muss alle Spalten der Tabelle enthalten (fehlende Spalten werden als `null`
behandelt, ausser NOT NULL-Spalten ohne Default — dort muss der Client immer einen Wert senden).

Server-Verhalten: pro Zeile `INSERT ... ON CONFLICT (id) DO UPDATE SET ... WHERE
{table}.updated_at < EXCLUDED.updated_at` (last-write-wins über `updated_at`).

**Rechteprüfung (all-or-nothing):** fehlt für irgendeine im Request enthaltene
Tabelle das `<area>:write`-Recht der aktuellen Rolle (Mapping in
`backend/app/tables.py:TABLE_AREA`), wird der GESAMTE Request mit 403
abgelehnt — kein teilweises Übernehmen einzelner Tabellen. Ausnahme:
`data_history` ist von dieser Prüfung ausgenommen (entsteht immer als
Nebeneffekt einer im selben Request bereits geprüften Schreibung auf einer
anderen Tabelle) — sonst bräuchte jede Rolle mit irgendeinem Schreibrecht
zusätzlich explizit `history:write`, sonst würde jeder Push komplett
abgelehnt.

Response 200: `{"accepted": {"farms": 2, "field_declarations": 104, ...}}`

## Pull

`GET /sync/pull?since=<ISO-8601 timestamp oder leer für Vollsync>`

Response 200:
```json
{
  "server_time": "2026-09-19T10:00:00Z",
  "tables": {
    "farms": [ ... ],
    "field_declarations": [ ... ]
  }
}
```
Client speichert `server_time` als neuen `since`-Wasserstand für den nächsten Pull
(vermeidet Uhr-Drift zwischen Client und Server). Bei leerem `since` werden alle
nicht-gelöschten UND gelöschten Zeilen zurückgegeben (Client muss `deleted_at`
selbst lokal anwenden, auch beim ersten Vollsync gibt es i.d.R. keine).

**Rechteprüfung:** Tabellen, für die der Rolle das `<area>:read`-Recht fehlt,
fehlen im `tables`-Objekt komplett (nicht leeres Array — der Key fehlt ganz).
Der bestehende Client-Code kommt damit unverändert klar (`if (!rows) continue`).

## Health

`GET /health` → `{"status": "ok"}`, kein Auth nötig.
