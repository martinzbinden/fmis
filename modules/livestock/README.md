# Mastplaner — Lämmermast-Tool

Überwacht die Lämmermast bis zur Schlachtung bei 45–50 kg Lebendgewicht:
Gewichtsverlauf, Medikamenteneinsatz inkl. Absetzfristen, Schlachtresultate
pro Ohrmarke, Futtermitteleinsatz pro Gruppe, und die Wirtschaftlichkeit pro
Tier und Gruppe.

Eigenständiges Modul im [FMIS-Repo](../../README.md). Alle Befehle unten
gehen davon aus, dass du in diesem Verzeichnis (`modules/livestock/`)
stehst.

## Architektur

- **Backend** (`backend/`): FastAPI, bewusst dünn — E-Mail-Magic-Link-Login
  (`/auth/*`), Nutzerverwaltung (`/admin/*`) und Sync-Relay (`/sync/push`,
  `/sync/pull`). Speichert dauerhaft in PostgreSQL.
- **Frontend** (`frontend/`): React + Vite + TypeScript. Die gesamte
  Anwendungslogik (CRUD, Formulare, Wirtschaftlichkeits-Auswertung) läuft
  gegen **pglite** — ein vollständiges Postgres im Browser (WASM), das
  identisch zum Server-Schema ist. Dadurch funktioniert die App **100%
  offline im Stall**; ein Hintergrund-Sync gleicht Änderungen mit dem
  zentralen PostgreSQL ab, sobald wieder Internet verfügbar ist.
- **`schema/`**: das kanonische SQL-Schema — einzige Quelle der Wahrheit,
  wird identisch in PostgreSQL und pglite angewendet. `schema/SYNC_API.md`
  dokumentiert den Sync-Kontrakt zwischen Frontend und Backend.
- **`backend/schema/`**: Nutzer/Rollen/Login-Tokens — bewusst NICHT Teil von
  `schema/*.sql`, läuft also nie in pglite mit (Nutzerdaten gehören nicht
  auf jedes Gerät repliziert).

## Login & Rechte

Kein Passwort mehr — Login per **E-Mail-Magic-Link**:

1. Nutzer gibt seine E-Mail-Adresse ein → bekommt einen Login-Link.
   **Der Link ist persistent** (`SESSION_TTL_DAYS`, standardmässig bis zu
   **1 Jahr**) und nicht nur einmalig — er kann z.B. als Lesezeichen/
   Homescreen-Shortcut gespeichert und beliebig oft geklickt werden, bis er
   abläuft oder ein neuer Link angefordert wird (das invalidiert ältere
   Links für diese Adresse). Da der Link so lange gültig ist, wirkt er wie
   ein Passwort — nicht weiterleiten.
2. **Neue Adressen starten als "wartet auf Freischaltung"** — erst wenn ein
   Admin eine Rolle zuweist, funktioniert der Login. Die Adresse aus
   `INITIAL_ADMIN_EMAIL` wird beim ersten Login automatisch als Admin
   freigeschaltet (Bootstrap).
3. Sperrt ein Admin ein Konto oder ändert die Rolle, wirkt das **sofort**
   (jeder Request prüft Rolle/Status live in der DB, kein Token-Blacklist
   nötig) — unabhängig davon, ob der Link selbst noch gültig wäre.

**Rollen sind feingranular** (Bereich × Lesen/Schreiben, z.B.
`medications:write`, `economics:read`) statt nur Admin/Nutzer-Binär.
Vordefiniert: *Admin* (alles inkl. Nutzerverwaltung), *Vollzugriff* (alles
ausser Nutzerverwaltung), *Nur Lesen*. Weitere Rollen lassen sich unter
"⚙️ → Nutzerverwaltung" (nur für Admins sichtbar) frei zusammenstellen.

Durchgesetzt wird das serverseitig beim Sync: `POST /sync/push` lehnt den
kompletten Request ab, wenn für irgendeine enthaltene Tabelle das
Schreibrecht fehlt; `GET /sync/pull` lässt Tabellen ohne Leserecht im
Response komplett weg — die Daten landen so nie lokal in pglite. Das
Frontend blendet zusätzlich UI aus, die eh nicht genutzt werden darf (reine
UX, keine Sicherheitsgrenze).

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

Laufende Gewichtsreihen lassen sich auf "Gewichte" → "CSV importieren"
ebenfalls per CSV nachtragen: eine Spalte mit der Ohrmarke plus eine oder
mehrere Gewichts-Spalten (z.B. eine pro Wägedatum) — welche Spalten
importiert werden und welches Datum ihnen zugeordnet wird, wählst du beim
Import selbst aus. Statt einer Datei kann die Tabelle auch direkt aus
Excel kopiert und in ein Textfeld eingefügt werden (Tab-getrennt).

## Bearbeiten, Löschen & Verlauf

Alle erfassten Datensätze (Tiere, Gruppen, Wägungen, Medikamente,
Futter-/Kosteneinträge, Schlachtresultate) lassen sich über die jeweilige
Detailseite nachträglich korrigieren oder löschen (Soft-Delete —
`deleted_at`, siehe `schema/SYNC_API.md`). Jede solche Änderung wird
automatisch historisiert: wer, wann, was geändert hat, sichtbar unter
"📜 Verlauf" (nur mit `history:read`-Recht, standardmässig alle Rollen).

## Medikamenten- und Futtermittel-Referenz

Weder für das Tierarzneimittelkompendium (vetpharm.uzh.ch /
tierarzneimittel.ch) noch für Futtermittel-Hersteller (UFA, FORS, …) gibt
es eine öffentliche API oder einen Datenexport — nur durchsuchbare
HTML-Seiten, und `robots.txt` von vetpharm.uzh.ch sperrt grosse Teile davon
für automatisierte Zugriffe. Da Absetzfristen rechtlich bindende,
lebensmittelsicherheitsrelevante Werte sind, gibt es deshalb bewusst
**keinen automatischen Hintergrund-Scraper**. Stattdessen: unter
"Medikamente" → "Referenz verwalten" bzw. "Futter" → "Referenz verwalten"
pflegt der Betrieb selbst eine kurze Liste (Absetzfrist pro Medikament,
Gehalte pro Futtermittel), die beim Erfassen automatisch vorschlägt. Ein
Link pro Eintrag öffnet eine Suche bei der jeweiligen Quelle, um den Wert
bei Bedarf schnell manuell gegenzuprüfen ("zuletzt geprüft"-Datum wird
dabei mitgeführt).

## Produktions-Deployment (Docker + bestehendes Traefik)

Setzt voraus: Traefik läuft bereits auf dem Docker-Host (Docker-Netzwerk
z.B. `web-netzwerk`), TLS wird vorgelagert terminiert (z.B. Nginx Proxy
Manager auf der Firewall, der `Host`-Header beim Weiterleiten erhält) —
Traefik selbst braucht hier **keinen eigenen certresolver**, das Backend
läuft auf reinem HTTP (`entrypoints=web`).

```bash
cp .env.example .env   # JWT_SECRET, INITIAL_ADMIN_EMAIL, SMTP_*, DOMAIN/PUBLIC_URL setzen
docker compose up --build -d
```

Frontend und Backend hängen sich über Labels an die vorhandene
Traefik-Instanz und teilen sich **eine Domain** (Pfad-basiertes Routing:
`/auth`, `/sync`, `/health`, `/docs` → Backend, alles andere → Frontend-SPA)
— dadurch ist alles same-origin, kein CORS-Setup nötig. Der
Postgres-Container hat kein `ports:`-Mapping mehr (nur intern erreichbar).

Falls dein Traefik-Netzwerk anders heisst als `web-netzwerk`: in
`docker-compose.yml` die beiden `networks: web-netzwerk` sowie
`traefik.docker.network=web-netzwerk`-Zeilen anpassen.

## Lokale Entwicklung (ohne Docker)

```bash
brew install postgresql@16
brew services start postgresql@16
createdb mastplaner

cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
DATABASE_URL=postgresql://$(whoami)@localhost:5432/mastplaner \
  JWT_SECRET=irgendein-secret \
  INITIAL_ADMIN_EMAIL=deine@adresse.ch \
  PUBLIC_URL=http://localhost:5173 \
  SMTP_HOST=localhost SMTP_PORT=1025 SMTP_USE_TLS=false \
  uvicorn app.main:app --reload
```

Die Migrationen aus `schema/*.sql` UND `backend/schema/*.sql` (Nutzer/
Rollen) werden beim Start automatisch angewendet. Ohne echten SMTP-Server
kann man lokal `python -m aiosmtpd -n -l localhost:1025` als Debug-Mailserver
laufen lassen — Mails werden dann als Klartext auf der Konsole ausgegeben
(Login-Link zum Copy-Pasten).

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:8000 für lokale Entwicklung
npm run dev
```

Öffnet auf `http://localhost:5173`. Die App lässt sich als PWA installieren
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
