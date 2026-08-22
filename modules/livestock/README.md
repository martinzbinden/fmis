# Mastplaner — Lämmermast-Tool

Überwacht die Lämmermast bis zur Schlachtung bei 45–50 kg Lebendgewicht:
Gewichtsverlauf, Medikamenteneinsatz inkl. Absetzfristen, Schlachtresultate
pro Ohrmarke, Futtermitteleinsatz pro Gruppe, und die Wirtschaftlichkeit pro
Tier und Gruppe.

Eigenständiges Modul im [FMIS-Repo](../../README.md). Alle Befehle unten
gehen davon aus, dass du in diesem Verzeichnis (`modules/livestock/`)
stehst.

## Architektur

- **Backend** (`backend/`): FastAPI, bewusst dünn — nur Login (`/auth/login`)
  und Sync-Relay (`/sync/push`, `/sync/pull`). Speichert dauerhaft in
  PostgreSQL.
- **Frontend** (`frontend/`): React + Vite + TypeScript. Die gesamte
  Anwendungslogik (CRUD, Formulare, Wirtschaftlichkeits-Auswertung) läuft
  gegen **pglite** — ein vollständiges Postgres im Browser (WASM), das
  identisch zum Server-Schema ist. Dadurch funktioniert die App **100%
  offline im Stall**; ein Hintergrund-Sync gleicht Änderungen mit dem
  zentralen PostgreSQL ab, sobald wieder Internet verfügbar ist.
- **`schema/`**: das kanonische SQL-Schema — einzige Quelle der Wahrheit,
  wird identisch in PostgreSQL und pglite angewendet. `schema/SYNC_API.md`
  dokumentiert den Sync-Kontrakt zwischen Frontend und Backend.
## Tiere importieren

Auf der Seite "Tiere" → "Tiere importieren" können neue Einstallungen direkt
erfasst werden:

- **PDF**: das TVD-Begleitdokument (Original, beliebig viele Seiten/Tiere)
  direkt hochladen — die Tierliste wird im Browser geparst (kein Server
  nötig), Duplikate durch ORIGINAL/KOPIE-Seiten werden automatisch anhand
  der Ohrmarke entfernt.
- **CSV**: alternativ eine Datei mit Spalten `ear_tag,birth_date,sex`
  (Geburtsdatum als `YYYY-MM-DD`).

Die hochgeladene Datei bleibt lokal im Browser und wird nie ins Projekt
oder nach git übernommen — echte Tierdaten gehören nicht ins Repo (siehe
`.gitignore`: `modules/livestock/seed/` ist bewusst ausgeschlossen, falls
du dort lokale Kopien ablegen willst).

## Starten

### Mit Docker (empfohlen für den Server-Teil)

```bash
APP_PASSWORD=dein-passwort docker compose up --build
```

Backend läuft danach auf `http://localhost:8000` (OpenAPI-Doku unter
`/docs`), PostgreSQL auf Port 5432.

### Ohne Docker (lokale PostgreSQL-Installation)

```bash
brew install postgresql@16
brew services start postgresql@16
createdb mastplaner

cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
DATABASE_URL=postgresql://$(whoami)@localhost:5432/mastplaner \
  APP_PASSWORD=dein-passwort \
  JWT_SECRET=irgendein-secret \
  uvicorn app.main:app --reload
```

Die Migrationen aus `schema/*.sql` werden beim Start automatisch angewendet.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL ggf. anpassen
npm run dev
```

Öffnet auf `http://localhost:5173`. Beim ersten Login das oben gesetzte
`APP_PASSWORD` verwenden. Die App lässt sich als PWA installieren
(Homescreen-Icon) und funktioniert danach auch ohne Netzverbindung — Sync
läuft automatisch im Hintergrund, sobald wieder online.

## Wichtige Design-Entscheidung: pglite ist führend

Alle Lese-/Schreibzugriffe der UI laufen **immer** gegen lokales pglite,
nie direkt gegen die REST-API. Das Backend wird nur für Login und den
Push/Pull-Sync kontaktiert. Das bedeutet: neue Tiere, Wägungen etc. offline
erfassen funktioniert ohne Einschränkung — der Sync holt es nach, sobald
wieder eine Verbindung besteht (last-write-wins über `updated_at`, siehe
`schema/SYNC_API.md`).

## Später: Ausbau zum FMIS

Das Datenmodell ist bewusst einzelbetrieblich (kein Mandanten-Feld) und auf
Lämmermast fokussiert gehalten. Für einen späteren Ausbau zu einem
umfassenderen Farm-Management-System sollten vor allem `schema/*.sql` um
weitere Bereiche (Flächen, Maschinen, ggf. Mandantentrennung) erweitert
werden — die Sync-Architektur (Tabellen-Registry in
`backend/app/tables.py` + `schema/SYNC_API.md`) skaliert dafür bereits.
Siehe auch die [Modul-Struktur im Root-README](../../README.md).
