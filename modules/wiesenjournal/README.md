# Wiesenjournal — Weide-/Wiesenjournal

Digitales Pendant zum Papier-Wiesenjournal: Nutzung (Weide/Eingrasen) und
Düngung pro Parzelle und Tag als Raster oder als flaches Journal, Weidegänge
als freiform gezeichnete Zaun-Geometrie auf der Karte (statt nur fixer
GELAN-Parzellen), plus betriebsweite Tagesmeldung (Laufhof/Auslauf,
Wetter/Niederschlag/Mond).

Fachmodul im gemeinsamen [FMIS-Repo](../../README.md) — Login, Rollen,
Deployment und die App-Shell sind geteilt (siehe Root-README und
[`core/`](../../core)); dieses README beschreibt nur, was in diesem Modul
(`modules/wiesenjournal/`) fachlich/technisch spezifisch ist. Eigene
Berechtigungen `wiesenjournal:parcels:*`, `wiesenjournal:weide:*`,
`wiesenjournal:nutzung:*`, `wiesenjournal:duengung:*`,
`wiesenjournal:tagesmeldung:*`, `wiesenjournal:history:read`, eigenes
Postgres-Schema `wiesenjournal`, eigene IndexedDB `idb://wiesenjournal`.

**Status: erster Wurf (2026-09-20)**, mit Beispieldaten für die Saison 2026
befüllt (siehe `schema/0003_seed_demo.sql`) — noch nicht mit dem Betrieb
besprochen/final.

## Datenmodell

- **`parcels`** — Parzellen-Stammdaten pro Saison (`season_year`): Name,
  Aren, Wiesentyp/Leitgras-Mischung, Intensität (i/wi/e/mi). Eigenständig,
  NICHT mit `modules/fields` verknüpft (Module sind isoliert, keine
  SQL-FK über Modulgrenzen hinweg möglich) — optional ein
  `base_geometry`-Referenz-Umriss (GeoJSON-Text), rein zur Orientierung auf
  der Karte, nicht massgeblich für die tatsächliche Weidegang-Grenze.
- **`paddocks`** — Weidegang-/Zaun-Geometrie, versioniert wie
  `modules/fields`' `plan_parcels` (jede Bearbeitung ist eine neue,
  unveränderliche Zeile mit `is_current`/`version_number`): der aktuelle
  Zaun-Ist-Zustand ist immer die jeweils aktuellste Version, die volle
  Historie bleibt erhalten. Trägt `animal_group` (freier Text) direkt —
  das ist die Tier-Standort-Antwort, kein Join auf Tierdaten nötig (und
  auch nicht möglich, siehe unten).
- **`usage_entries`** (Nutzung) / **`fertilization_entries`** (Düngung) —
  je ein Eintrag pro Ereignis an einem Tag, referenziert `parcels`.
- **`n_dose_summary`** — Stickstoff-Zusammenfassung (geplant/effektiv) pro
  Parzelle+Gabe (Applikationsrunde) — die rechte Spaltengruppe des
  Papierformulars.
- **`daily_farm_log`** — betriebsweite Tagesmeldung (Laufhof/Auslauf,
  Wetter/Niederschlag/Mond), eine Zeile pro Tag, kein Parzellenbezug.

## Kein technischer Bezug zu livestock/dairy/fields

Wie alle Module läuft `wiesenjournal` mit eigenem Postgres-Schema und
eigener pglite-IndexedDB — eine SQL-Fremdschlüsselbeziehung über
Modulgrenzen hinweg ist architektonisch nicht möglich (siehe
Root-README/Architektur). Tierbezüge (`animal_group` auf `usage_entries`/
`paddocks`) sind deshalb bewusst freier Text, keine Referenz auf
`livestock.animals`/`dairy.animals`.

**Karte, Kulturen-Vorlage**: Als praktische Erleichterung (nicht als
Datenbank-Verknüpfung) kann die Karte optional die aktuell im selben
Browser synchronisierten Parzellen des Kulturen-Moduls als blass-blaue
Vorlage einblenden (`components/PaddockMap.tsx`, Button
„Kulturen-Vorlage") — dafür öffnet der Client direkt eine zweite,
rein lesende pglite-Verbindung auf `idb://fields` (dieselbe Browser-
IndexedDB, die das Kulturen-Modul selbst anlegt). Ein Klick auf eine
solche Vorlagen-Parzelle übernimmt deren Geometrie 1:1 als neuen
Weidegang — für den Fall, dass der reale Zaun exakt der deklarierten
Parzelle entspricht, ohne sie manuell nachzeichnen zu müssen. Funktioniert
nur, wenn das Kulturen-Modul in diesem Browser schon mal geöffnet/
synchronisiert wurde; sonst bleibt die Vorlage einfach leer (kein Fehler).

## Deployment & lokale Entwicklung

Kein eigenständiges Deployment/Dev-Setup — Backend und Frontend werden
zusammen mit den anderen Modulen als **eine** App gebaut und deployt. Siehe
[Root-README](../../README.md).
