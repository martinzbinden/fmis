# Kulturen — Kulturflächen & Fruchtfolgeplanung

Wertet den jährlichen kantonalen "Raumdatenexport Bewirtschafter" aus
(ESRISHAPE-Format, EPSG:2056/CH1903+LV95): Kulturflächen auf einer Karte
mit swisstopo-Hintergrund (Pixelkarte/Luftbild), plus eine mehrjährige
Fruchtfolgeplanung pro Parzelle (inkl. Zwischenfutter) als Grundlage für
ein späteres Feldjournal.

Fachmodul im gemeinsamen [FMIS-Repo](../../README.md) — Login, Rollen,
Deployment und die App-Shell sind seit dem Merge geteilt (siehe Root-README
und [`core/`](../../core)); dieses README beschreibt nur, was in diesem
Modul (`modules/fields/`) fachlich/technisch spezifisch ist. Eigene
Berechtigung `fields:fields:*`/`fields:history:read`, eigenes
Postgres-Schema `fields`, eigene IndexedDB `idb://fields`.

## Besonderheit: zwei Betriebe, eine Datenbank

Anders als `modules/dairy`/`modules/livestock` (je auf einen Betrieb
bezogen) verwaltet dieses Modul **zwei Betriebe** (die als
Betriebszweiggemeinschaft/ÖLN-Gemeinschaft zusammenarbeiten) in **einer**
gemeinsamen Datenbank — jede Zeile ist über `farm_id` einem Betrieb
zugeordnet (u.a. für die separate Jahresabrechnung je Betrieb). Vor dem
Merge lief das Frontend dafür über zwei separate Domains (eine pro
Betrieb, mit getrennten Browser-Logins/pglite-Kopien); seit dem Merge
teilen sich alle Module (inkl. beider Betriebe hier) eine Domain und
Origin — ein Login genügt für beide Betriebe, die lokale pglite-Kopie
enthält beider Betriebe Daten gemeinsam (weiterhin unterschieden über
`farm_id`).

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

## Deployment & lokale Entwicklung

Es gibt kein eigenständiges Deployment/Dev-Setup für dieses Modul mehr —
Backend und Frontend werden zusammen mit den anderen Modulen als **eine**
App gebaut und deployt. Siehe [Root-README](../../README.md) für
`docker compose up` (Produktion) und den lokalen Dev-Server.
