#!/usr/bin/env bash
# Testumgebung (dev-fmis) und Freigabe für Prod — läuft auf dem Server, aus cron.
#
#   fmis-deploy.sh dev              Testumgebung: neuer Commit auf main? Dann Prod-Daten
#                                   holen, Code ziehen, neu bauen, prüfen.
#   fmis-deploy.sh dev --immer      dasselbe, auch ohne neuen Commit (z.B. frische Daten)
#   fmis-deploy.sh freigabe         Prod: liegt eine Freigabe im Briefkasten? Dann sichern,
#                                   genau diesen Commit einspielen, prüfen.
#   fmis-deploy.sh freigeben SHA    Freigabe von Hand anfordern (wie der Knopf in der App)
#   fmis-deploy.sh stand            Stand für die App neu schreiben (ohne Deploy)
#
# cron (Benutzer dev):
#   */2 * * * * /opt/stacks/fmis-dev/tools/deploy/fmis-deploy.sh dev >> /opt/stacks/fmis-dev/deploy.log 2>&1
#   * * * * *   /opt/stacks/fmis/tools/deploy/fmis-deploy.sh freigabe >> /opt/stacks/fmis/freigabe.log 2>&1
#
# Richtung der Daten: nur Prod → Testumgebung. Das Skript schreibt nur in die Datenbank
# des Compose-Projekts der Testumgebung und prüft das vor dem Löschen.
# Prod ändert sich nur über `freigabe`, und nur auf einen Commit, der gerade auf der
# Testumgebung läuft. Nie `git pull` von Hand in /opt/stacks/fmis.
#
# Alles steht in main(): bash liest das Skript damit ganz ein, bevor es läuft — ein
# `git merge` mitten im Lauf ändert die Datei, ohne den laufenden Ablauf zu stören.

main() {
  set -euo pipefail

  PROD_DIR="${FMIS_PROD_DIR:-/opt/stacks/fmis}"
  DEV_DIR="${FMIS_DEV_DIR:-/opt/stacks/fmis-dev}"
  BOX="$DEV_DIR/freigabe"
  BACKUPS="${FMIS_BACKUPS:-$HOME/backups}"
  DB_USER=fmis
  DB_NAME=fmis

  log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
  die() {
    log "FEHLER: $*"
    exit 1
  }
  # im Projektverzeichnis: dort liegen .env (Projektname, COMPOSE_FILE) und die Compose-Dateien
  dc_in() { (cd "$1" && shift && docker compose "$@"); }
  dc_prod() { dc_in "$PROD_DIR" "$@"; }
  dc_dev() { dc_in "$DEV_DIR" "$@"; }
  now_iso() { date -Iseconds; }

  # JSON sicher schreiben (Python statt Textbausteine: Commit-Titel enthalten Anführungszeichen)
  write_json() { # Datei, dann Python-Ausdruck mit den Variablen aus der Umgebung
    local file="$1" expr="$2"
    python3 -c "import json, os, sys; d = $expr; json.dump(d, open(sys.argv[1] + '.tmp', 'w'), ensure_ascii=False); os.replace(sys.argv[1] + '.tmp', sys.argv[1])" "$file"
  }
  read_json() { # Datei, Schlüssel
    python3 -c "import json, sys; print(json.load(open(sys.argv[1])).get(sys.argv[2]) or '')" "$1" "$2" 2>/dev/null || true
  }

  wait_healthy() { # Projektverzeichnis
    local i
    for i in $(seq 1 60); do
      if dc_in "$1" exec -T backend python -c \
        "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3)" >/dev/null 2>&1; then
        return 0
      fi
      sleep 3
    done
    return 1
  }

  container_of() { # Projektverzeichnis, Dienst
    dc_in "$1" ps -q "$2"
  }

  write_stand() {
    local dev_sha prod_sha
    dev_sha="$(git -C "$DEV_DIR" rev-parse HEAD)"
    prod_sha="$(git -C "$PROD_DIR" rev-parse HEAD)"
    local commits
    if git -C "$DEV_DIR" cat-file -e "$prod_sha^{commit}" 2>/dev/null; then
      commits="$(git -C "$DEV_DIR" log --format='%H%x09%s' "$prod_sha..$dev_sha")"
    else
      commits=""
    fi
    DEV_SHA="$dev_sha" PROD_SHA="$prod_sha" COMMITS="$commits" DATENSTAND="$(cat "$BOX/datenstand.txt" 2>/dev/null || true)" \
      write_json "$BOX/stand.json" "{
        'dev_sha': os.environ['DEV_SHA'], 'prod_sha': os.environ['PROD_SHA'],
        'datenstand': os.environ['DATENSTAND'] or None,
        'aktualisiert': '$(now_iso)',
        'commits': [dict(zip(('sha', 'titel'), l.split('\t', 1))) for l in os.environ['COMMITS'].splitlines() if l]}"
  }

  # ── Testumgebung ────────────────────────────────────────────────────────────
  cmd_dev() {
    local immer="${1:-}"
    cd "$DEV_DIR"
    [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "Testumgebung nicht auf main"
    git fetch -q origin main
    local target last_ok
    target="$(git rev-parse origin/main)"
    last_ok="$(cat "$BOX/dev_ok" 2>/dev/null || true)"
    if [ "$target" = "$last_ok" ] && [ "$immer" != "--immer" ]; then
      return 0
    fi
    log "Testumgebung: ${last_ok:0:7} → ${target:0:7}"
    [ -z "$(git status --porcelain --untracked-files=no)" ] || die "Arbeitsverzeichnis der Testumgebung nicht sauber"

    # Ziel muss wirklich die Testumgebung sein — nie Prod überschreiben
    local prod_db dev_db
    prod_db="$(container_of "$PROD_DIR" postgres)"
    dev_db="$(container_of "$DEV_DIR" postgres)"
    [ -n "$prod_db" ] || die "Prod-Datenbank läuft nicht"
    if [ -z "$dev_db" ]; then
      dc_dev up -d postgres
      dev_db="$(container_of "$DEV_DIR" postgres)"
    fi
    [ "$prod_db" != "$dev_db" ] || die "Quelle und Ziel sind derselbe Container"
    [ "$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$dev_db")" = fmis-dev ] ||
      die "Ziel-Datenbank gehört nicht zum Projekt fmis-dev"

    git merge -q --ff-only "$target"
    log "baue …"
    dc_dev build -q

    log "Prod-Daten holen …"
    local dump
    dump="$(mktemp --suffix=.sql.gz)"
    trap 'rm -f "$dump"' RETURN
    docker exec "$prod_db" pg_dump -U "$DB_USER" "$DB_NAME" | gzip >"$dump"
    gzip -t "$dump"
    dc_dev stop backend
    docker exec "$dev_db" dropdb -U "$DB_USER" --force --if-exists "$DB_NAME"
    docker exec "$dev_db" createdb -U "$DB_USER" -T template0 "$DB_NAME"
    gunzip -c "$dump" | docker exec -i "$dev_db" psql -q -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 >/dev/null
    echo "$(now_iso) ${target:0:7}" >"$BOX/datenstand.txt"

    dc_dev up -d
    if ! wait_healthy "$DEV_DIR"; then
      write_stand
      die "Testumgebung antwortet nicht (Logs: docker compose logs backend in $DEV_DIR)"
    fi
    echo "$target" >"$BOX/dev_ok"
    write_stand
    log "Testumgebung läuft auf ${target:0:7}"
  }

  # ── Freigabe ────────────────────────────────────────────────────────────────
  cmd_freigeben() {
    local sha="${1:-}"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || sha="$(git -C "$DEV_DIR" rev-parse --verify "${sha:-HEAD}^{commit}")"
    SHA="$sha" VON="${USER:-shell} (Befehl)" write_json "$BOX/angefordert.json" \
      "{'sha': os.environ['SHA'], 'von': os.environ['VON'], 'am': '$(now_iso)'}"
    log "Freigabe von ${sha:0:7} angefordert"
  }

  cmd_freigabe() {
    [ -f "$BOX/angefordert.json" ] || return 0
    local sha von am
    sha="$(read_json "$BOX/angefordert.json" sha)"
    von="$(read_json "$BOX/angefordert.json" von)"
    am="$(read_json "$BOX/angefordert.json" am)"
    rm -f "$BOX/angefordert.json"
    result() { # ergebnis, meldung
      SHA="$sha" VON="$von" AM="$am" ERG="$1" MELDUNG="${2:-}" write_json "$BOX/freigabe.json" \
        "{'sha': os.environ['SHA'], 'von': os.environ['VON'], 'am': os.environ['AM'], 'ergebnis': os.environ['ERG'], 'meldung': os.environ['MELDUNG'], 'fertig': '$(now_iso)'}"
    }
    fail() {
      result fehler "$1"
      die "$1"
    }

    cd "$PROD_DIR"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "Ungültige Anfrage"
    [ "$(git -C "$DEV_DIR" rev-parse HEAD)" = "$sha" ] || fail "Die Testumgebung läuft nicht mehr auf ${sha:0:7} — nichts eingespielt"
    [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || fail "Prod nicht auf main"
    [ -z "$(git status --porcelain --untracked-files=no)" ] || fail "Arbeitsverzeichnis von Prod nicht sauber — nichts eingespielt"
    local prev
    prev="$(git rev-parse HEAD)"
    [ "$prev" != "$sha" ] || {
      result ok "Lief schon auf diesem Stand"
      return 0
    }
    git fetch -q origin main
    git merge-base --is-ancestor "$prev" "$sha" || fail "${sha:0:7} baut nicht auf dem Prod-Stand ${prev:0:7} auf — nichts eingespielt"
    result laeuft "Sicherung und Einspielen"
    log "Freigabe ${prev:0:7} → ${sha:0:7} (von $von)"

    mkdir -p "$BACKUPS"
    local backup
    backup="$BACKUPS/fmis-$(date +%Y%m%d-%H%M%S)-freigabe-${sha:0:7}.sql.gz"
    docker exec "$(container_of "$PROD_DIR" postgres)" pg_dump -U "$DB_USER" "$DB_NAME" | gzip >"$backup"
    gzip -t "$backup" || fail "Sicherung unlesbar — nichts eingespielt"
    log "Sicherung $backup"

    git merge -q --ff-only "$sha"
    if dc_prod up --build -d && wait_healthy "$PROD_DIR"; then
      result ok "Sicherung: $(basename "$backup")"
      write_stand
      log "Prod läuft auf ${sha:0:7}"
      return 0
    fi
    # Zurück auf den alten Code; die Datenbank bleibt (Sicherung liegt bereit)
    log "Prod antwortet nicht — zurück auf ${prev:0:7}"
    git reset -q --hard "$prev"
    dc_prod up --build -d || true
    wait_healthy "$PROD_DIR" || log "ACHTUNG: Prod antwortet auch auf ${prev:0:7} nicht"
    write_stand
    fail "Prod startete auf ${sha:0:7} nicht, zurück auf ${prev:0:7}. Sicherung: $(basename "$backup")"
  }

  mkdir -p "$BOX"
  # Ein Lauf zur Zeit (beide Befehle lesen bzw. ändern Prod); besetzt = nächste Minute
  exec 9>"$BOX/.lock"
  flock -n 9 || exit 0

  case "${1:-}" in
    dev) cmd_dev "${2:-}" ;;
    freigabe) cmd_freigabe ;;
    freigeben) cmd_freigeben "${2:-}" ;;
    stand) write_stand ;;
    *)
      sed -n '2,12p' "$0"
      exit 2
      ;;
  esac
}

main "$@"
