# Mastplaner — Lämmermast-Tool

Überwacht die Lämmermast bis zur Schlachtung bei 45–50 kg Lebendgewicht:
Gewichtsverlauf, Medikamenteneinsatz inkl. Absetzfristen, Schlachtresultate
pro Ohrmarke, Futtermitteleinsatz pro Gruppe, und die Wirtschaftlichkeit pro
Tier und Gruppe.

Fachmodul im gemeinsamen [FMIS-Repo](../../README.md) — Login, Rollen,
Deployment und die App-Shell sind seit dem Merge geteilt (siehe Root-README
und [`core/`](../../core)); dieses README beschreibt nur, was in diesem
Modul (`modules/livestock/`) fachlich/technisch spezifisch ist.

## Architektur

- **`backend/app/{tables,sync}.py`**: die modulspezifische Hälfte des
  Backends — welche Tabellen syncbar sind (`SYNC_TABLES`) und welchem
  Berechtigungsbereich sie zugeordnet sind (`TABLE_AREA`, präfixiert mit
  `livestock:`, z.B. `livestock:medications:write`). Auth/Admin/DB/E-Mail
  sind geteilter Code in [`core/backend/fmis_core`](../../core/backend/fmis_core).
- **`frontend/src/`**: React-Seiten/-Komponenten dieses Moduls, plus
  `module.tsx` (der "Descriptor", über den sich das Modul bei der
  App-Shell anmeldet — Navigation, Routen, eigene pglite-Instanz/Sync-Client)
  und `theme.css` (Markenfarbe, siehe Root-README "Theming"). Die gesamte
  Anwendungslogik (CRUD, Formulare, Wirtschaftlichkeits-Auswertung) läuft
  gegen **pglite** — ein vollständiges Postgres im Browser (WASM), das
  identisch zum Server-Schema dieses Moduls ist (eigenes Postgres-Schema
  `livestock`, eigene IndexedDB `idb://mastplaner`). Dadurch funktioniert
  die App **100% offline im Stall**; ein Hintergrund-Sync gleicht
  Änderungen mit PostgreSQL ab, sobald wieder Internet verfügbar ist.
- **`schema/`**: das kanonische SQL-Schema dieses Moduls — einzige Quelle
  der Wahrheit, wird identisch in Postgres (Schema `livestock`) und pglite
  angewendet. `schema/SYNC_API.md` dokumentiert den Sync-Kontrakt.

## Login & Rechte

Login (E-Mail-Magic-Link) und Rollenverwaltung sind jetzt app-weit geteilt
— siehe [Root-README](../../README.md#login--rechte) für den Ablauf.
Dieses Modul bringt nur seine eigenen, präfixierten Berechtigungen mit
(`livestock:animals:*`, `livestock:groups:*`, `livestock:weighings:*`,
`livestock:medications:*`, `livestock:feed:*`, `livestock:expenses:*`,
`livestock:slaughter:*`, `livestock:economics:read`,
`livestock:history:read`) — durchgesetzt serverseitig in `sync.py` (siehe
`core/backend/fmis_core/schema/0001_core.sql` für die Standardrollen).

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

## Deployment & lokale Entwicklung

Es gibt kein eigenständiges Deployment/Dev-Setup für dieses Modul mehr —
Backend und Frontend werden zusammen mit den anderen Modulen als **eine**
App gebaut und deployt. Siehe [Root-README](../../README.md) für
`docker compose up` (Produktion) und den lokalen Dev-Server
(`.claude/launch.json` bzw. `cd backend && uvicorn app.main:app`,
`cd frontend && npm run dev`, jeweils vom Repo-Root aus mit
`PYTHONPATH`/Workspace wie dort beschrieben).

## Wichtige Design-Entscheidung: pglite ist führend

Alle Lese-/Schreibzugriffe der UI laufen **immer** gegen lokales pglite,
nie direkt gegen die REST-API. Das Backend wird nur für Login und den
Push/Pull-Sync (`/livestock/sync/*`) kontaktiert. Das bedeutet: neue Tiere,
Wägungen etc. offline erfassen funktioniert ohne Einschränkung — der Sync
holt es nach, sobald wieder eine Verbindung besteht (last-write-wins über
`updated_at`, siehe `schema/SYNC_API.md`).
