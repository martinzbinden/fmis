# Tools

Eigenständige Hilfsskripte, kein Teil der laufenden App.

- **`apr600_diagnostic.py`** — Diagnose-Tool für die geplante Agrident-
  APR600-Schnittstelle (Ohrmarkenleser → dairy/livestock). Verbindet sich
  als TCP-Client zum Leser (der Leser selbst lauscht auf einem Port, z.B.
  `192.168.0.111:2010` — muss auf einem PC im selben Netz wie der Leser
  laufen, nicht hier im Dev-Container). Protokolliert jede empfangene
  Byte-Sequenz roh (Hex + Text) sowie erkannte `[BEFEHL|...]`-Frames mit
  Zeitstempel in eine Logdatei. Reines Python-Standardbibliothek-Skript,
  kein `pip install` nötig. Details/Nutzung siehe Docstring im Skript.

  Das Frame-Format (`[BEFEHL|Feld1|Feld2|...]`, Antworten `[BEFEHL|OK|...]`
  bzw. `[BEFEHL|ERROR]`) sowie mehrere echte Befehle (`XGGROUPS`,
  `XGGROUP`/`XGGROUPX`, `XGMEMINFO`/`XGMEM`/`XGMEMA`, `XEMEM`) wurden durch
  direkte Analyse der Agrident-eigenen `AgriLink.exe` (.NET-Assembly)
  gewonnen — nicht durch Raten. Offen ist noch das genaue Format, wenn der
  Leser beim Live-Scannen unaufgefordert eine gelesene Ohrmarke sendet
  (für die Melkliste) — dafür ist dieses Diagnose-Tool gedacht.

- **`apr600_tasks.py`** — erzeugt Aufgaben für den Task-Modus des APR600 (Menü «Tasks» am Gerät) als
  Projektdatei für AgriLink, z.B. `python3 tools/apr600_tasks.py ablammung -o Ablammung.apr`. In AgriLink
  «Load Tasks from File…» öffnen (AgriLink prüft die Datei), dann «Upload Task Definitions». Das Format ist
  aus `AgriLink.exe` abgelesen (INI: `[Project]`, `[Task.N.Definition]`, `Field<n>`, `Option<n>.<m>`) und noch
  nicht mit einer echten Aufgabe verglichen; `test_apr600_tasks.py` prüft Aufbau, Rundlauf und die
  abgelesenen Prüfregeln. Aufgaben schreibt das Skript nie selbst aufs Gerät.

- **`import_adis.py`** — Herdebuch-Export (ADIS, Datenschnittstelle
  Rindvieh-Schweiz, ZIP wie von der Zuchtorganisation geliefert) von der
  Kommandozeile in eine dairy-Instanz (`--instance dairy` für Milchkühe,
  `dairy_schafe` für Milchschafe) einspeisen — gleiche Logik wie der
  Browser-Import unter "Tiere", aber über die Sync-API des Servers, damit
  Rechte/Verlauf identisch laufen und alle Clients die Daten per Pull
  bekommen. Idempotent (wiederholter Import erzeugt keine Duplikate),
  `--dry-run` zum Prüfen. Reine Standardbibliothek. Login per
  `--password` (TEST_LOGIN_PASSWORD, nur Testumgebung), `--magic-token`
  (Token aus dem eigenen Login-Link) oder `--token`. Details/Nutzung siehe
  Docstring im Skript.

- **`import_raumdaten.py`** — Kantonaler "Raumdatenexport Bewirtschafter"
  (ZIP mit Shapefiles, ein ZIP pro Betrieb und Jahr, beliebig viele auf
  einmal) von der Kommandozeile ins Modul Kulturen einspeisen — Gegenstück
  zu "Karte → Raumdaten importieren", gleiche Abgleichschlüssel und
  Projektionsdefinition, ebenfalls über die Sync-API. Braucht GDAL-Python
  und pyproj (`apt install python3-gdal python3-pyproj`). Idempotent;
  bewahrt bei Re-Import manuell gepflegte Felder (Notizen, Sorte, Daten).

- **`import_wiesenjournal_xlsx.py`** — Excel-Wiesenjournal (Hauptsheet
  „Wiesenjournal", Tagesraster mit Legenden-Codes) ins Modul Wiesenjournal
  einspeisen: Nutzung je Tierkategorie/Tagweide, Schnitte, Pflege, Düngung
  (inkl. Fass → m³, Verdünnung, Teilflächen-Hinweise als Notiz), Laufhof/
  Niederschlag/Notizen/Tierzahlen. Excel-Zeilen werden per Name den GELAN-
  Parzellen zugeordnet (vorher „Aus GELAN übernehmen" oder `--import-gelan`),
  der Rest wird als Excel-Parzelle angelegt und kann in der App per „GELAN
  zuordnen" zusammengeführt werden. `--dry-run`, `--report CSV` (Zuordnung +
  Heuristik-Entscheide), `--mapping JSON`, idempotent, schützt in der App
  bearbeitete Zeilen (`--force`). Braucht openpyxl.

- **`leitungskataster_pdf.py`** — Leitungskataster-Auszug (PDF aus dem
  Geoportal des Kantons Bern, je Werk eine PDF-Ebene als Rasterbild) in eine
  Grundlage für die Karte der Bauprojekte umwandeln: Ebenen auslesen, über
  das 100-m-Kreuznetz in LV95 einpassen (`--kreuz E,N` = Kreuz unten links,
  aus der Randbeschriftung abgelesen), Weiss transparent machen, in die
  Kartenprojektion umrechnen. Ergebnis ist ein ZIP (manifest.json + PNG je
  nicht leerer Ebene), das in FMIS unter Bauprojekte → Karte → 🗂️ →
  «Grundlage hinzufügen» hochgeladen wird. Braucht mutool, poppler,
  GDAL, Pillow und numpy.

## Commit-Prüfung (`git-hooks/`)

Das Repo ist öffentlich. `git-hooks/pruefung.py` stoppt jeden Commit und Push mit Geheimnissen, Personendaten und echten
Betriebsdaten. Geprüft werden Pfade, hinzugefügte Zeilen und die Commit-Nachricht. Die Meldung nennt Datei, Zeile und Art, nie den Wert.

- **Muster:** private Schlüssel, Tokens, JWT, Passwort-Hashes, Passwörter in URLs, Klartext-Zuweisungen, IBAN, AHV-Nummern und
  Kartennummern (mit Prüfziffer), Zufallswerte, Mailadressen, verbotene Pfade und Dateitypen (`.env`, `secrets/`, Dumps, PDF, Excel, CSV).
- **Echte Werte:** Geheimnisse aller Stacks und lokalen Projekte, Mailadressen, Namen, Ohrmarken, Beträge und Betriebsnummern, nur als
  gesalzene Hashes in `.git/fmis-pruefung/werte.json`. Der Server berechnet sie; die Klartexte verlassen ihn nicht.

Nach einem neuen Klon:

```bash
git config core.hooksPath tools/git-hooks
git config fmis.server <ssh-ziel>
tools/git-hooks/pruefung.py --werte-holen
```

Auf dem Server selbst ist `fmis.server` der Wert `lokal`. Ohne Vergleichswerte wird abgelehnt. Nach dem Ändern von Geheimnissen oder
monatlich `--werte-holen` neu ausführen. `--alle` prüft den aktuellen Stand, `--historie` die ganze Geschichte.
Tests: `python3 -m unittest tools/git-hooks/test_pruefung.py`.

Die Prüfung nie mit `--no-verify` umgehen. Ein Fund, der keiner ist: Der Betriebsleiter entscheidet, der Fingerabdruck aus der Meldung
kommt dann mit Grund in `git-hooks/ausnahmen.txt`.
