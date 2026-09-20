# FMIS — Farm-Management-Informationssystem

Eine App für mehrere Fachbereiche (Module) eines landwirtschaftlichen
Betriebs: **ein Login, eine zentrale Rollenverwaltung, ein
docker-compose**. Module lassen sich unabhängig entwickeln und zur
Laufzeit (ohne Neustart/Redeploy) aktivieren/deaktivieren.

## Module

- **[modules/livestock](modules/livestock/README.md)** — Lämmermast:
  Gewichtsüberwachung, Medikamenteneinsatz, Schlachtresultate,
  Futtermittel, Wirtschaftlichkeit.
- **[modules/dairy](modules/dairy/README.md)** — Milchleistung: kg
  Fett/Eiweiss pro Kuh, Joghurt-Kuhauswahl.
- **[modules/fields](modules/fields/README.md)** — Kulturen: Kulturflächen
  aus dem kantonalen Raumdatenexport auf einer Karte (swisstopo-
  Hintergrund) plus mehrjährige Fruchtfolgeplanung. Verwaltet zwei
  Betriebe (Betriebszweiggemeinschaft) in einer gemeinsamen Datenbank.
- **[modules/wiesenjournal](modules/wiesenjournal/README.md)** —
  Wiesenjournal: digitales Weide-/Wiesenjournal (Nutzung/Düngung pro
  Parzelle und Tag als Raster oder flaches Journal, freiform gezeichnete
  Weidegänge auf der Karte statt nur fixer Parzellen, Tagesmeldung).
  Erster Wurf, Stand 2026-09-20.

Alle vier sind **offline-fähig** (pglite — vollständiges Postgres im
Browser, WASM) mit Hintergrund-Sync gegen PostgreSQL, sobald wieder
Internet verfügbar ist.

## Architektur

```
core/
  backend/fmis_core/   geteilter Server-Code: Auth (Magic-Link/JWT), Nutzer-
                        /Rollenverwaltung, Modul-Registry/-Umschalter, DB-
                        Verbindungs-Pooling (ein Postgres-Schema pro Modul)
  frontend/src/         geteilte App-Shell: Login, Auth-Context, Layout/Nav,
                        Sync-Client-Fabrik, Admin-Seite
backend/
  app/main.py            baut die Module zusammen: mountet core/ + jedes
                          aktivierte Moduls Sync-Router unter /<modul>/sync/*
frontend/
  src/App.tsx            baut die Module zusammen: liest GET /core/modules
                          nach dem Login, mountet Navigation/Routen nur für
                          aktuell aktivierte Module
modules/<name>/
  backend/app/{tables,sync}.py   modulspezifische Sync-Tabellen + Rechte
  frontend/src/                  modulspezifische Seiten/Komponenten,
                                  module.tsx (Descriptor für die App-Shell)
  schema/*.sql                   modulspezifisches Datenschema (identisch
                                  in Postgres UND client-seitig in pglite)
```

Jedes Modul bringt sein eigenes Postgres-**Schema** mit (`livestock`,
`dairy`, `fields`, alle in einer DB), seine eigene pglite-**IndexedDB** im
Browser (unabhängig von den anderen, gleichzeitig nutzbar) und seinen
eigenen Sync-Loop — nur Login/Rollen/Modul-Umschalter sind in `public`
(bzw. `core/`) geteilt.

## Login & Rechte

Login per **E-Mail-Magic-Link**, app-weit (ein JWT für alle Module):

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
3. Sperrt ein Admin ein Konto, ändert die Rolle, oder schaltet ein Modul
   ab, wirkt das **sofort** (jeder Request prüft Rolle/Status/Modul-Status
   live in der DB, kein Token-Blacklist nötig).

**Rollen sind feingranular** (Modul × Bereich × Lesen/Schreiben, z.B.
`livestock:medications:write`, `fields:fields:read`) statt nur
Admin/Nutzer-Binär. Vordefiniert: *Admin* (alles inkl. Nutzer-/
Modulverwaltung), *Vollzugriff* (alles ausser Verwaltung), *Nur Lesen* —
alle drei decken standardmässig ALLE Module ab (siehe
`core/backend/fmis_core/schema/0001_core.sql`); engere, modulspezifische
Rollen lassen sich unter "⚙️ Verwaltung" (nur für Admins sichtbar) frei
zusammenstellen. Dort lässt sich auch jedes Modul einzeln aktivieren/
deaktivieren — deaktivierte Module verschwinden aus Navigation/Dashboard
und lehnen ihre Sync-Endpunkte ab, ohne dass ein Rebuild nötig ist.

Durchgesetzt wird das serverseitig beim Sync: `POST /<modul>/sync/push`
lehnt den kompletten Request ab, wenn für irgendeine enthaltene Tabelle
das Schreibrecht fehlt; `GET /<modul>/sync/pull` lässt Tabellen ohne
Leserecht im Response komplett weg — die Daten landen so nie lokal in
pglite. Das Frontend blendet zusätzlich UI aus, die eh nicht genutzt
werden darf (reine UX, keine Sicherheitsgrenze).

## Deployment (Docker + Traefik)

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
`/auth`, `/core`, `/admin`, `/<modul>/sync`, `/health`, `/docs` →
Backend, alles andere → Frontend-SPA) — dadurch ist alles same-origin,
kein CORS-Setup nötig. Der Postgres-Container hat kein `ports:`-Mapping
(nur intern erreichbar).

Falls dein Traefik-Netzwerk anders heisst als `web-netzwerk`: in
`docker-compose.yml` die beiden `networks: web-netzwerk` sowie
`traefik.docker.network=web-netzwerk`-Zeilen anpassen.

## Lokale Entwicklung

Am einfachsten über die vorkonfigurierten Dev-Server in
`.claude/launch.json` (`fmis-backend`/`fmis-frontend`, je ein
Docker-Container inkl. Wegwerf-Postgres). Manuell:

```bash
# Backend — vom Repo-Root aus (core/ und modules/ müssen auf dem PYTHONPATH sein)
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
cd ..
DATABASE_URL=postgresql://$(whoami)@localhost:5432/fmis \
  JWT_SECRET=irgendein-secret \
  INITIAL_ADMIN_EMAIL=deine@adresse.ch \
  PUBLIC_URL=http://localhost:5173 \
  PYTHONPATH=. \
  backend/.venv/bin/uvicorn app.main:app --app-dir backend --reload
```

```bash
# Frontend — npm-Workspace am Repo-Root (core/ und modules/*/frontend/src
# liegen ausserhalb von frontend/, node_modules muss deshalb am Repo-Root
# installiert werden, nicht in frontend/ selbst)
npm install
cd frontend
cp .env.example .env 2>/dev/null || true   # VITE_API_URL=http://localhost:8000
npm run dev
```

Oder mit Docker (`docker compose -f docker-compose.yml -f
docker-compose.local.yml up --build`) — Backend auf `:8000`, Frontend auf
`:8080`, Postgres auf `:5433`.

## Ein Modul hinzufügen

1. `modules/<name>/{backend/app,schema,frontend/src}` nach dem Muster
   eines bestehenden Moduls anlegen (`tables.py`+`sync.py` fürs Backend,
   `module.tsx`+`theme.css` fürs Frontend).
2. In `core/backend/fmis_core/module_registry.py` einen `ModuleSpec`-
   Eintrag ergänzen, in `backend/app/main.py` den Sync-Router importieren
   und mounten.
3. In `frontend/src/App.tsx` den Descriptor-Import zu `AVAILABLE_MODULES`
   hinzufügen.
4. Berechtigungen modul-präfixiert vergeben (`<name>:<bereich>:<aktion>`)
   und in `core/backend/fmis_core/schema/0001_core.sql` den Standardrollen
   sowie in `core/frontend/src/admin.ts` (`ALL_PERMISSIONS`) ergänzen.

Das neue Modul erscheint danach automatisch in der `modules`-Tabelle
(aktiviert per Default) und kann jederzeit über "⚙️ Verwaltung" umgeschaltet
werden, ohne dass Code dafür geändert werden muss.
