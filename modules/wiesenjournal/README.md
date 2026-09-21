# Wiesenjournal — Weide-/Wiesenjournal

Digitales Pendant zum Papier-Wiesenjournal: Nutzung (Weide/Eingrasen) und
Düngung pro Parzelle und Tag als Raster oder als flaches Journal, Weidegänge
als freiform gezeichnete Zaun-Geometrie auf der Karte (statt nur fixer
GELAN-Parzellen), betriebsweite Tagesmeldung (Laufhof/Auslauf,
Wetter/Niederschlag/Mond), eine Jahresauswertung (echte PostGIS-Verschneidung
der Weidegänge mit den GELAN-Parzellen aus dem Kulturen-Modul), plus
GPS-Traktor-Tracking (inkl. GPX-Export) und Unkraut-Erfassung (Blacken/
Disteln/Andere — manuell oder als Vorschlag aus einer GPS-Verweilpause).

Fachmodul im gemeinsamen [FMIS-Repo](../../README.md) — Login, Rollen,
Deployment und die App-Shell sind geteilt (siehe Root-README und
[`core/`](../../core)); dieses README beschreibt nur, was in diesem Modul
(`modules/wiesenjournal/`) fachlich/technisch spezifisch ist. Eigene
Berechtigungen `wiesenjournal:parcels:*`, `wiesenjournal:weide:*`,
`wiesenjournal:nutzung:*`, `wiesenjournal:duengung:*`,
`wiesenjournal:tagesmeldung:*`, `wiesenjournal:tracking:*`,
`wiesenjournal:history:read`, eigenes Postgres-Schema `wiesenjournal`,
eigene IndexedDB `idb://wiesenjournal`.

**Stand 2026-09-21:** Journal-Parzellen sind die GELAN-Parzellen des
Kulturen-Moduls, das Nutzungsmodell entspricht der Legende des Papier-/
Excel-Journals, Düngung mit Nährstoffrechnung und Flächenbezug (ganze
Parzelle, Teilfläche, GPS-Track), Jahresauswertung und Düngungskarte. Die
Demo-Daten des ersten Wurfs (`0003_seed_demo.sql`) sind per
`0009_remove_demo.sql` wieder entfernt. Excel-Import: `tools/
import_wiesenjournal_xlsx.py`.

## Parzellen = GELAN-Parzellen

`parcels` wird pro Saison aus `fields.field_declarations` befüllt
(`POST /wiesenjournal/parcels/import-from-fields?year=`, Button „Aus GELAN
übernehmen" auf der Parzellen-Seite; `backend/app/parcels_import.py`) —
serverseitig, weil beide Modul-Schemas in derselben Datenbank liegen und nur
der Server die massgebliche PostGIS-Geometrie hat. Schlüssel ist
`(season_year, fields_lineage_id)` (GELAN „ID Kultur", stabil über die
Jahre); Name/Fläche/Kultur/Betrieb/Geometrie werden nachgeführt, manuell
gepflegte Felder (Wiesentyp, Intensität, Bemerkung) bleiben. `category`
(futter 6xx / acker 5xx) steuert den Umschalter „Ackerkulturen anzeigen"
(`hooks/useShowAcker.ts`, pro Gerät in localStorage). Manuell oder aus
Excel angelegte Parzellen (`source` manual/excel, ohne Geometrie) lassen
sich per „GELAN zuordnen" in eine GELAN-Parzelle überführen
(`lib/parcels.ts: mergeParcel`).

## Nutzung (Legende)

`usage_entries.usage_type` deckt die Papierlegende ab: Weide je Tierkategorie
(`animal_category` X Kühe / Y Rinder / Z Kälber / G Galtkühe / W Schafe /
V Legehennen, `day_only` = Kleinbuchstabe = nur Tagweide), Eingrasen,
Silage/Dürrfutter (mit Ertrag Rb/Fu/St), Weide putzen, Blacken (stechen/
Einzelstock/Fläche), Übersaat/Saat (Mischung, kg/ha), Aufwuchshöhe (cm),
Pflug/Striegeln/Säuberungsschnitt, Sonstiges. Mehrere Einträge pro Parzelle
und Tag sind normal; das Raster zeigt die Buchstaben (`lib/format.ts:
usageLegend`). `daily_farm_log` führt Laufhof je Kategorie und Tierzahlen.

## Düngung, Nährstoffe, Flächenbezug

- **`fertilizer_types`** — Düngerarten mit Gehalten je m³/t/kg (Startwerte
  ca. GRUD 2017, als Richtwerte gekennzeichnet, Seite „Düngerarten"),
  Verdünnungsbasis (Gülleanteil) und Gefäss (Fass 6.5 m³ / Fuder).
- **`fertilization_entries`** — Massnahme mit Düngerart, Menge (oder Anzahl
  Fass/Fuder), Verdünnung, `extent_type`: `parcel` (ganze Parzelle),
  `parcels` (mehrere), `polygon` (frei gezeichnet — Zaunstreifen, Rand,
  oben/unten, oder Weidegang übernommen; `components/ExtentPicker.tsx`),
  `track` (GPS-Fahrt mit Arbeitsbreite gepuffert). Nährstoff-Totale
  (`lib/nutrients.ts` ↔ `backend/app/nutrients.py`, keep in sync).
- **`fertilization_shares`** — Verteilung jeder Massnahme auf die GELAN-
  Parzellen. Ganze Parzelle(n) rechnet der Client offline; Polygon/Track
  gehen über `POST /wiesenjournal/fertilization/resolve-extent` (PostGIS-
  Verschneidung in LV95, Internet nötig), der Client schreibt Massnahme +
  Anteile dann wie gewohnt per Sync. `POST …/recompute-shares?year=`
  rechnet alles neu (nach GELAN-Übernahme, geänderten Düngerarten, Excel-
  Import); der Verlaufseintrag trägt dann den System-Akteur
  `recompute-shares (…)`.
- **Auswertung** — `GET /wiesenjournal/reports/nutrients?year=` (Σ je
  Parzelle, kg N/ha, Totale je Betrieb/Kategorie, CSV) und
  `GET …/reports/fertilization-map?year=` (Düngungskarte: planarer
  Verschnitt aller Massnahmen via `ST_Node`/`ST_Polygonize`, je Teilfläche
  Summe kg N/ha — grenzunabhängig; Karte → „Düngungskarte").

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
- **`tracks`** — GPS-Aufzeichnung einer Traktorfahrt (LineString-Geometrie,
  wächst während der Aufzeichnung, `point_times` als parallele
  Zeitstempel-Liste fürs GPX-Export). Nicht versioniert wie `paddocks` —
  während einer laufenden Aufzeichnung wird die Zeile einfach fortgeschrieben,
  nach `ended_at` gilt sie als abgeschlossen.
- **`weed_observations`** — Unkraut-Fund (Punkt-Geometrie): Art
  (Blacken/Disteln/Andere), Befall, optionale Behandlung. `source` unterscheidet
  `manual` (Kartenklick/aktueller GPS-Fix) von `gps_dwell` (aus einer erkannten
  Verweilpause während einer Track-Aufzeichnung vorgeschlagen — die Bestätigung
  ist aber immer ein manueller Klick, nie vollautomatisch).

## PostGIS (server-seitig) & Jahresauswertung

`geometry`/`base_geometry` (dieses Modul) und `geometry` (Kulturen-Modul)
sind seit `schema/server/0001_postgis_geometry.sql` echte PostGIS-Spalten
auf dem Server — der Client (pglite) sieht davon nichts und arbeitet
weiterhin mit reinem GeoJSON-Text; die Umwandlung passiert ausschliesslich
in `backend/app/sync.py` (`ST_AsGeoJSON`/`ST_GeomFromGeoJSON` an der
Sync-Grenze). Bewusste Entscheidung: eine clientseitige PostGIS-Extension
für pglite existiert zwar (`@electric-sql/pglite-postgis`), ist aber laut
Hersteller experimentell (unbehandelte C++-Exceptions können die Instanz
zum Absturz bringen) und würde ~18.8 MB zusätzlich pro Modul-Bundle
bedeuten — für eine offline im Stall genutzte PWA nicht vertretbar.

Neue Migrationen (egal für welches Modul), die eine `geometry`-Spalte
brauchen, gehören deshalb NICHT direkt unter `schema/*.sql` (das läuft 1:1
auch in pglite, das kein PostGIS hat), sondern in einen `schema/server/`-
Unterordner — pglites Migrations-Glob ist nicht rekursiv und sieht diesen
Ordner nie (siehe `db/pglite.ts`), während `core/backend/fmis_core/db.py`s
Migrations-Runner ihn zusätzlich anwendet.

Die **Jahresauswertung** (`GET /wiesenjournal/reports/parcel-overlap`,
Seite „Auswertung") verschneidet `wiesenjournal.paddocks` mit
`fields.field_declarations` via `ST_Intersects`/`ST_Intersection` (beide
Module liegen in derselben physischen Postgres-Datenbank, nur getrennte
Schemas — eine schema-qualifizierte Abfrage braucht keine zusätzlichen
Rechte) und zeigt pro GELAN-Parzelle die überlappende Fläche/Prozent —
ohne dass sich Weidegänge je an Parzellengrenzen halten müssten.

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

## GPS-Tracking & Unkraut (Karte-Seite)

„🚜 Tracking starten" nutzt `navigator.geolocation.watchPosition` direkt
(nicht nur Leaflets `map.locate()`, das nur einen einzelnen/zentrierten Fix
liefert — hier wird jeder rohe Fix gebraucht), schreibt den wachsenden Track
periodisch nach pglite (`lib/tracking.ts: saveTrackProgress`), damit bei
einem Tab-Absturz nichts verloren geht. **Bewusst nur im Vordergrund**
(Bildschirm an, Seite offen — z.B. Tablet in der Traktorkabine): Browser
können GPS im Hintergrund ohnehin nicht zuverlässig aufzeichnen (v.a.
iOS-Safari-PWA-Limit), eine native App wäre der einzige Weg dahin.

Die **Verweilpausen-Erkennung** (`lib/geo.ts: detectDwell`, feste Schwellen
15 m / 60 s) läuft nur während einer aktiven Aufzeichnung und schlägt einen
Unkraut-Fund lediglich vor — geschrieben wird nichts, bis der Nutzer aktiv
bestätigt und die Art (Blacken/Disteln/Andere) wählt. Die Schwellenwerte
sind Startwerte und dürften nach echten Fahrten angepasst werden.

„🌿 Unkraut melden" nutzt den letzten bekannten GPS-Fix (`onLocationFound`,
z.B. von einem vorherigen „Mein Standort"-Klick oder aus einer laufenden
Aufzeichnung); ist keiner bekannt, fällt es auf einen Kartenklick zurück
(`components/PaddockMap.tsx: MapClickCatcher`).

**GPX-Export** (`lib/gpx.ts`) ist ein handgeschriebener, minimaler GPX-1.1-
Serializer — kein zusätzliches npm-Paket nötig, das Format ist dafür
einfach genug.

## Deployment & lokale Entwicklung

Kein eigenständiges Deployment/Dev-Setup — Backend und Frontend werden
zusammen mit den anderen Modulen als **eine** App gebaut und deployt. Siehe
[Root-README](../../README.md).
