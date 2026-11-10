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

Authelia braucht eine Regel für `dev-fmis.riedackerhof.ch` (nur Gruppe admins), sonst
antwortet die Testumgebung mit 403. Dann `fmis-deploy.sh dev --immer` und die zwei cron-Zeilen
aus dem Kopf von `fmis-deploy.sh`.
