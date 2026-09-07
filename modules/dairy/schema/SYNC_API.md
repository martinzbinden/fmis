# Sync-API-Kontrakt

Das Backend ist bewusst dünn: Auth + Sync-Relay + dauerhafte Speicherung.
Sämtliche CRUD-Logik und Auswertungen laufen im Frontend direkt gegen
pglite (identisches Schema wie `schema/0001_init.sql`, inkl. der Views).
Der Server wird nur für Push/Pull kontaktiert.

## Syncbare Tabellen und Spaltenreihenfolge

Diese Reihenfolge ist verbindlich für Push-Payloads (Backend validiert per Name, Reihenfolge ist nur Doku):

- `animals`: id, ear_tag, name, breed_code, birth_date, sex, status, entry_date, exit_date, notes, updated_at, deleted_at
- `milk_tests`: id, animal_id, test_date, calving_date, lactation_number, milk_kg, fat_pct, protein_pct, lactose_pct, cell_count, urea_mg_dl, updated_at, deleted_at
- `data_history`: id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at — Audit-Log, wird
  ausschliesslich automatisch von `upsertRow()`/`softDeleteRow()` befüllt (siehe `frontend/src/db/write.ts`),
  nie direkt von einem Formular. Kein `deleted_at` (unveränderlich). `snapshot` ist die komplette Zeile NACH
  der Änderung als JSON-Text.

Views (`v_animal_milk_current`) werden NICHT gesynct — sie werden lokal in
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
    "animals": [ { "id": "...", "ear_tag": "...", "...": "...", "updated_at": "2026-08-17T10:00:00Z", "deleted_at": null } ],
    "milk_tests": [ ... ]
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

Response 200: `{"accepted": {"animals": 3, "milk_tests": 12, ...}}`

## Pull

`GET /sync/pull?since=<ISO-8601 timestamp oder leer für Vollsync>`

Response 200:
```json
{
  "server_time": "2026-08-22T09:00:00Z",
  "tables": {
    "animals": [ ... Zeilen mit updated_at > since ... ],
    "milk_tests": [ ... ]
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
