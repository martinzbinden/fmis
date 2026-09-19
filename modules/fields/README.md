# Kulturen — Kulturflächen & Fruchtfolgeplanung

Wertet den jährlichen kantonalen "Raumdatenexport Bewirtschafter" aus
(ESRISHAPE-Format, EPSG:2056/CH1903+LV95): Kulturflächen auf einer Karte
mit swisstopo-Hintergrund (Pixelkarte/Luftbild), plus eine mehrjährige
Fruchtfolgeplanung pro Parzelle (inkl. Zwischenfutter) als Grundlage für
ein späteres Feldjournal.

Eigenständiges Modul im [FMIS-Repo](../../README.md), Architektur 1:1
gespiegelt von [modules/livestock](../livestock/README.md) — siehe dort für
Details zu Login/Rechten, Sync-Mechanismus, Bearbeiten/Löschen/Verlauf und
Produktions-Deployment.

## Besonderheit: zwei Betriebe, eine Datenbank, zwei Domains

Anders als `modules/dairy`/`modules/livestock` (je eine eigenständige
Instanz pro Betrieb) verwaltet dieses Modul **zwei Betriebe** (die als
Betriebszweiggemeinschaft/ÖLN-Gemeinschaft zusammenarbeiten) in **einer**
gemeinsamen Datenbank — jede Zeile ist über `farm_id` einem Betrieb
zugeordnet (u.a. für die separate Jahresabrechnung je Betrieb). Ein
Backend/eine Postgres-DB laufen einmal, das Frontend ist aber über **zwei
Domains** erreichbar (`DOMAIN_1`/`DOMAIN_2` in `.env`, siehe
`docker-compose.yml` — zwei Traefik-Host-Regeln auf denselben Service),
damit jeder Betrieb seine eigene, vertraute URL behält.

Da Browser-Storage (localStorage/IndexedDB) origin-gebunden ist, bedeutet
das konkret: Login-Token und die lokale pglite-Offline-Kopie sind **pro
Domain separat** (ein Login-Link gilt nicht automatisch für beide Domains
gleichzeitig — bei Bedarf einfach auf beiden je einmal per Magic-Link
anmelden). Beide Domains synchronisieren aber gegen dieselbe Datenbank, die
Karte und alle Daten sind also gemeinsam sichtbar, sobald synchronisiert
wurde.

## Datenimport

Unter "Karte" → "Raumdaten importieren" eines oder mehrere ZIPs des
kantonalen Raumdatenexports auswählen (ein ZIP pro Betrieb, beide können
gleichzeitig ausgewählt werden). Gelesen werden die 4 Shapefile-Layer aus
`ESRISHAPE_1/shapefile/` (Betrieb, Bewirtschaftungseinheiten,
Kulturflächen als Polygone/Punkte) — die im selben ZIP enthaltene
GeoPackage-Kopie wird nicht genutzt. Koordinaten werden von CH1903+/LV95
(EPSG:2056) nach WGS84 reprojiziert (`proj4`, siehe `lib/importFields.ts`).

Wiederholter Import ist idempotent: Betriebe werden über die UID
abgeglichen, Bewirtschaftungseinheiten über (Betrieb, ID BewE, Jahr),
Kulturflächen über (Betrieb, ID Kultur, Jahr) — es entstehen keine
Duplikate. Die hochgeladenen Dateien bleiben lokal im Browser und landen
nie im Projekt oder in git.

## Fruchtfolgeplanung

Unter "Fruchtfolge" wird jede Parzelle als "Linie" über die Jahre
dargestellt (verbunden über eine `lineage_id`, die beim Import anhand der
stabilen "ID Kultur" abgeglichen wird — kein Geometrie-Matching). Für ein
zukünftiges Jahr kann direkt eine geplante Kultur erfasst werden (inkl.
Zwischenfutter als zweiter Eintrag im selben Jahr); Fläche/Geometrie/
Flurname werden dabei von der letzten bekannten Deklaration übernommen.

## Produktions-Deployment (Docker + bestehendes Traefik)

```bash
cp .env.example .env   # JWT_SECRET, INITIAL_ADMIN_EMAIL, SMTP_*, DOMAIN_1/DOMAIN_2/PUBLIC_URL setzen
docker compose up --build -d
```

## Lokale Entwicklung

```bash
cd frontend
npm install
cp .env.example .env   # VITE_API_URL=http://localhost:8002 für lokale Entwicklung
npm run dev
```

Oder mit Docker (`docker compose -f docker-compose.yml -f
docker-compose.local.yml up --build`) — Backend auf `:8002`, Frontend auf
`:8083`, Postgres auf `:5436` (bewusst andere Ports als
`modules/livestock`/`modules/dairy`, damit alle Module gleichzeitig lokal
laufen können).
