# Milchleistung — Milchkühe

Wertet den Herdebuch-/Milchleistungsprüfungs-Export für Milchkühe aus:
kg Fett und kg Eiweiss prominent pro Kuh, plus ein Werkzeug für die
Joghurt-Kuhauswahl (Teilmenge mit mengengewichtetem Ø-Eiweiss ≥ 3.7%).

Fachmodul im gemeinsamen [FMIS-Repo](../../README.md) — Login, Rollen,
Deployment und die App-Shell sind seit dem Merge geteilt (siehe Root-README
und [`core/`](../../core)); dieses README beschreibt nur, was in diesem
Modul (`modules/dairy/`) fachlich/technisch spezifisch ist. Architektur
1:1 gespiegelt von [modules/livestock](../livestock/README.md), eigene
Berechtigungen `dairy:animals:*`, `dairy:milk:*`, `dairy:history:read`,
eigenes Postgres-Schema `dairy`, eigene IndexedDB `idb://dairy`.

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

## Deployment & lokale Entwicklung

Es gibt kein eigenständiges Deployment/Dev-Setup für dieses Modul mehr —
Backend und Frontend werden zusammen mit den anderen Modulen als **eine**
App gebaut und deployt. Siehe [Root-README](../../README.md) für
`docker compose up` (Produktion) und den lokalen Dev-Server.

## Milchwägung (Ohrmarkenleser APR600)

Seite „Milchwägung": die Tiere laufen der Reihe nach am Lesegerät vorbei,
der Melkstand hat n Plätze (Standard 12 = eine „Bank"). Die Wägungssitzung
läuft **auf dem Server** (`backend/app/reader.py`: `POST /<instanz>/reader/
session/start|stop|next-bank`, `GET …/session`, SSE `…/session/events`) —
Leser-Verbindung und Keep-alive sind damit unabhängig vom Browser; das Handy
darf die Seite verlassen. Jede Lesung wird sofort als `milking_slots`-Zeile
in die offene `milking_banks`-Zeile geschrieben (Bank voll → nächste Bank
automatisch, „Nächste Bank" schliesst sie auch vorzeitig), der Client zieht
sie per Sync nach (SSE-Tick → sofortiger Pull). Auf dem Melkstand: Häkchen
„gewogen", grosse **Laufnummer** (`animals.lauf_nr`, ADIS K01 283-286),
Ohrmarke/Transponder klein, Notiz je Zeile (wird ins `animal_journal` des
Tiers kopiert), Umsortieren mit sichtbarer Lese-Reihenfolge bis zum
Speichern, Archiv der abgeschlossenen Bänke, manuelle Aufnahme per
Laufnummer/Ohrmarke als Offline-Fallback. Der Server schreibt Slots nur beim
Lesen; alle Änderungen danach macht der Client per Sync (keine Konflikte).
