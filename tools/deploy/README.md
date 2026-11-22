# Testumgebung und Freigabe

Zwei Instanzen auf dem Server (192.168.0.73):

| | Verzeichnis | Adresse | Compose-Projekt | Code |
|---|---|---|---|---|
| Prod | `/opt/stacks/fmis` | fmis.riedackerhof.ch | `fmis-app` | nur freigegebene Commits |
| Test | `/opt/stacks/fmis-dev` | dev-fmis.riedackerhof.ch | `fmis-dev` | folgt `main` automatisch |

## Ablauf

1. Commit auf `main` und push.
2. Die Testumgebung holt ihn innerhalb von 2 Minuten (cron, `fmis-deploy.sh dev`):
   Prod-Datenbank abziehen und in die Testumgebung einspielen, Code ziehen, neu bauen,
   Gesundheitsprüfung. Die Geräte auf dev-fmis verwerfen beim nächsten Öffnen ihre lokale
   Kopie (neuer Datenstand, `core/frontend/src/instance.ts`).
3. Prüfen auf dev-fmis.riedackerhof.ch (gelbes Band «Testumgebung»).
4. Ein Admin gibt frei: Verwaltung → 🚀 Freigabe → Knopf gedrückt halten. Die Anfrage landet
   im Briefkasten `/opt/stacks/fmis-dev/freigabe/`.
5. Prod holt sie innerhalb einer Minute ab (cron, `fmis-deploy.sh freigabe`): Sicherung nach
   `~/backups/fmis-<zeit>-freigabe-<commit>.sql.gz`, genau diesen Commit einspielen, neu bauen,
   prüfen. Startet Prod nicht, geht der Code auf den alten Stand zurück (die Datenbank
   bleibt, die Sicherung liegt bereit). Das Ergebnis steht auf der Seite Freigabe.

Freigeben geht nur für den Commit, der gerade auf der Testumgebung läuft, und nur vorwärts
(der Prod-Stand muss darin enthalten sein). Von Hand, ohne App:

    /opt/stacks/fmis-dev/tools/deploy/fmis-deploy.sh freigeben         # Stand der Testumgebung
    /opt/stacks/fmis-dev/tools/deploy/fmis-deploy.sh dev --immer       # frische Prod-Daten ohne neuen Commit

**Nie `git pull` in `/opt/stacks/fmis`.** Prod ändert sich nur über die Freigabe.

## Testumgebung und echte Daten

Die Testumgebung enthält echte Betriebs- und Personendaten. Darum:

- Zugang nur über Authelia, auch für die Oberfläche (`TRAEFIK_APP_MIDDLEWARES=authelia-chain@file`).
- Mail nur an `MAIL_ALLOWLIST` (Testpostfächer), alles andere wird verworfen
  (`core/backend/fmis_core/email.py`). Benachrichtigungen erscheinen trotzdem unter der Glocke.
- Eigenes `JWT_SECRET`: Anmeldungen von Prod gelten hier nicht und umgekehrt.
- Daten fliessen nur Prod → Test; das Skript prüft vor dem Löschen, dass die Ziel-Datenbank
  zum Projekt `fmis-dev` gehört.

## Einrichten (einmalig)

    cd /opt/stacks && git clone https://github.com/martinzbinden/fmis.git fmis-dev
    cp fmis/docker-compose.override.yml fmis-dev/      # Härtung wie Prod
    mkdir -m 777 fmis-dev/freigabe                     # Backend (root ohne Capabilities) schreibt Anfragen

`.env` der Testumgebung (Werte aus Prod übernehmen, wo nicht anders angegeben):

    COMPOSE_PROJECT_NAME=fmis-dev
    COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml:docker-compose.dev.yml
    ROUTER=fmis-dev
    DOMAIN=dev-fmis.riedackerhof.ch
    PUBLIC_URL=https://dev-fmis.riedackerhof.ch
    TRAEFIK_APP_MIDDLEWARES=authelia-chain@file
    MAIL_ALLOWLIST=testuser1@riedackerhof.ch,testuser2@riedackerhof.ch
    JWT_SECRET=<neu>
    POSTGRES_PASSWORD=<neu>
    # wie Prod: TRAEFIK_*, SMTP_*, LOGIN_DOMAINS, SSO_ENABLED, INITIAL_ADMIN_EMAIL, SESSION_TTL_DAYS

Ausserhalb dieses Repos (eingerichtet 2026-11-15, Details in `/opt/gateway/docs/sicherheitskonzept.md`):

- **Authelia** (erste Instanz, CT106): Regel für `dev-fmis.riedackerhof.ch`, `two_factor`, nur Gruppe
  `admin-it` (die frühere Gruppe `admins` gibt es nicht mehr). Ohne Regel antwortet die Testumgebung
  mit 403. Skript: `/opt/gateway/docs/authelia-dev-fmis-regel.sh`.
- **Pi-hole** (Raspi und Replikat CT107): `dev-fmis.riedackerhof.ch` → `192.168.0.73` (Traefik).
  Skript: `/opt/gateway/docs/pihole-dev-fmis.py`.
- **Kein öffentlicher DNS-Eintrag:** Der Wildcard bei KAS zeigt nicht auf den Homeserver, die
  Testumgebung ist darum nur im Heimnetz erreichbar. Das ist Absicht: Sie läuft mit Code vor der
  Produktion, die API-Pfade laufen ohne Authelia, und die Bremse für den Mail-Link (`rl-fmis-auth`
  in `/opt/gateway/traefik-dynamic/sicherheit.yml`) gilt nur für `fmis.`. Vor einem öffentlichen
  CNAME `dev-fmis` → `523.riedackerhof.ch` zuerst diese Bremse für `dev-fmis.` ergänzen.
- **Zertifikat:** Das Wildcard-Zertifikat `*.riedackerhof.ch` deckt den Namen ab.

Dann `fmis-deploy.sh dev --immer` und die zwei cron-Zeilen aus dem Kopf von `fmis-deploy.sh`.

## Fotos (Volume `photos_data`)

Fotos zu Arbeiten, Betriebs- und Stalljournal liegen als Dateien im Volume `photos_data` (im Container `/data/photos`,
`core/backend/fmis_core/photo_files.py`), nicht in der Datenbank. Die Sicherung bei jeder Freigabe (`pg_dump`) enthält
sie darum nicht: Fotos sind zweite Priorität und werden getrennt (oder gar nicht) gesichert.

- Ablage: `/data/photos/<modul>/<JJJJ>/<MM>/<id>.webp` und Vorschau `<id>-t.webp`.
- Sichern, z.B. wöchentlich: `docker run --rm -v fmis_photos_data:/p -v ~/backups:/b alpine tar czf /b/fmis-fotos-$(date +%Y%m%d).tgz -C /p .`
- Archivieren: einen ganzen alten Ordner (z.B. `betrieb/2026`) aus dem Volume wegschieben. Die App zeigt dann
  «archiviert»; die Angaben (wer, wann, wozu) bleiben in der Datenbank.
- Ältere Fotos der Milchtiere (vor 11.2026) liegen noch in der Datenbank (`journal_photo_data`), neue als Dateien.
- Die Testumgebung hat eigene, leere Fotos: Prod-Fotos erscheinen dort als «noch nicht hochgeladen».
