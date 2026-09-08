# Milchleistung — Milchkühe

Wertet den Herdebuch-/Milchleistungsprüfungs-Export für Milchkühe aus:
kg Fett und kg Eiweiss prominent pro Kuh, plus ein Werkzeug für die
Joghurt-Kuhauswahl (Teilmenge mit mengengewichtetem Ø-Eiweiss ≥ 3.7%).

Eigenständiges Modul im [FMIS-Repo](../../README.md), Architektur 1:1
gespiegelt von [modules/livestock](../livestock/README.md) — siehe dort für
Details zu Login/Rechten, Sync-Mechanismus, Bearbeiten/Löschen/Verlauf und
Produktions-Deployment (nur die Kommandos unten unterscheiden sich: andere
Pfade/Ports/Domain, siehe `docker-compose.yml`/`.env.example`). Alle
Befehle unten gehen davon aus, dass du in diesem Verzeichnis
(`modules/dairy/`) stehst.

## Datenimport

Unter "Kühe" → "Herdebuch-Export importieren" werden alle Dateien eines
ADIS-Herdebuch-Exports ("Datenschnittstelle Rindvieh-Schweiz", Qualitas AG)
ausgewählt und im Browser geparst — die Satzart wird pro Zeile an den
ersten 3 Zeichen erkannt (K01 = Tier-Stammdaten, K33 = alle Milchproben),
nicht am Dateinamen (der weicht in manchen Exportversionen ab, z.B. trägt
eine Datei mit der Endung `.Y01` intern K01-Sätze). Alle anderen Satzarten
(Exterieur, Zuchtwerte, Besamung, Abkalbung, Betriebs-Jahresdurchschnitte
usw.) werden ignoriert — für die aktuellen Features nicht gebraucht.

Wiederholter Import (neuer Export) ist idempotent: Tiere werden über die
Ohrmarke abgeglichen, Milchtests über (Tier, Testdatum) — es entstehen
keine Duplikate. Die hochgeladenen Dateien bleiben lokal im Browser und
landen nie im Projekt oder in git (siehe Root-`.gitignore`: `input/` ist
bewusst ausgeschlossen, falls du dort lokale Kopien des Exports ablegen
willst).

## Produktions-Deployment (Docker + bestehendes Traefik)

```bash
cp .env.example .env   # JWT_SECRET, INITIAL_ADMIN_EMAIL, SMTP_*, DOMAIN/PUBLIC_URL setzen
docker compose up --build -d
```

Läuft unter einer eigenen Domain (Vorschlag `milch.riedackerhof.ch`, per
`DOMAIN` in `.env` frei wählbar) neben `modules/livestock` auf demselben
Traefik/Docker-Host — eigene Router-Namen (`dairy-api`/`dairy-app`), eigene
Postgres-Instanz, eigenes Login.

## Lokale Entwicklung (ohne Docker)

```bash
brew install postgresql@16
brew services start postgresql@16
createdb dairy

cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
DATABASE_URL=postgresql://$(whoami)@localhost:5432/dairy \
  JWT_SECRET=irgendein-secret \
  INITIAL_ADMIN_EMAIL=deine@adresse.ch \
  PUBLIC_URL=http://localhost:5173 \
  SMTP_HOST=localhost SMTP_PORT=1025 SMTP_USE_TLS=false \
  uvicorn app.main:app --reload
```

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:8000 für lokale Entwicklung
npm run dev
```

Oder mit Docker (`docker compose -f docker-compose.yml -f
docker-compose.local.yml up --build`) — Backend auf `:8001`, Frontend auf
`:8082`, Postgres auf `:5435` (bewusst andere Ports als `modules/livestock`,
damit beide Module gleichzeitig lokal laufen können).
