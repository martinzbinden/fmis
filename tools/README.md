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
