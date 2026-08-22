# FMIS Mastplaner

Wird schrittweise zu einem umfassenderen Farm-Management-Informationssystem
(FMIS) ausgebaut. Fachliche Bereiche leben als eigenständige, in sich
geschlossene Module unter `modules/`, damit sie unabhängig entwickelt,
später bei Bedarf in ein eigenes Repo ausgelagert oder als Plugin in einen
künftigen FMIS-Core eingebunden werden können.

## Module

- **[modules/livestock](modules/livestock/README.md)** — Lämmermast:
  Gewichtsüberwachung, Medikamenteneinsatz, Schlachtresultate,
  Futtermittel, Wirtschaftlichkeit. Offline-fähig (pglite), Sync zu
  PostgreSQL. Aktuell das einzige Modul.

## Warum ein Modul und (noch) kein eigenes Repo

Ein Ordner lässt sich jederzeit günstig in ein eigenes Repo aufspalten
(z.B. `git subtree split`, Historie bleibt erhalten). Umgekehrt mehrere
Repos wieder zusammenzuführen ist mühsam. Solange es nur ein Modul gibt und
kein Bedarf an unabhängiger Versionierung/Deployment besteht, bleibt alles
in diesem Repo — die Modul-Grenze existiert aber schon jetzt sauber im
Code (jedes Modul hat sein eigenes Schema, Backend, Frontend, sogar sein
eigenes `docker-compose.yml`).

Es gibt aktuell **keinen** technischen Plugin-Loader oder FMIS-Core — das
lohnt sich erst, sobald ein zweites Modul dazukommt und der gemeinsame
Bedarf (z.B. gemeinsames Login, gemeinsame Navigation, geteilte
Stammdaten wie Betrieb/Parzellen) sichtbar wird. Bis dahin ist
`modules/livestock` eine vollständig eigenständige App.
