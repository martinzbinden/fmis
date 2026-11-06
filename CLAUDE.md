# Hinweise für Claude Code

- **Das Repo ist öffentlich.** Nie Geheimnisse, Personendaten oder echte Betriebsdaten committen, auch nicht in Tests: keine echten Ohrmarken, Namen, Beträge, IBAN. Testwerte erfinden.
- **Commit-Prüfung:** `tools/git-hooks/pruefung.py` läuft bei jedem Commit und Push (siehe `tools/README.md`). Nicht mit `--no-verify` umgehen, gefundene Werte nicht ins Gespräch holen. Nach neuem Klon `git config core.hooksPath tools/git-hooks`. Dateien einzeln mit `git add <datei>` vormerken.
- **Server:** Änderungen nur über einen Commit in diesem Repo, nie direkt im Arbeitsverzeichnis auf dem Server. Deploy nur auf Wort des Betriebsleiters.
- **Der Kalender-Link** (`modules/betrieb/backend/app/duty_feed.py`) ist auch die Schnittstelle zur Zeit-App (Repo zeitlohn): Was sie liest, steht im Modulkopf und in `test_duty_feed.py`.
