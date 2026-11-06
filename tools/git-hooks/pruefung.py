#!/usr/bin/env python3
"""Stoppt Commits und Pushes mit Geheimnissen, Personendaten und echten Betriebsdaten.

Das Repo ist öffentlich. Geprüft wird, was neu dazukommt: Pfade, hinzugefügte Zeilen, Commit-Nachricht.
Die Ausgabe nennt nur Datei, Zeile und Art, nie den Wert.

    pruefung.py                  vorgemerkte Änderungen (pre-commit)
    pruefung.py --nachricht F    Commit-Nachricht in Datei F (commit-msg)
    pruefung.py --push           zu pushende Commits, Referenzen auf stdin (pre-push)
    pruefung.py --alle           alle versionierten Dateien
    pruefung.py --historie       jede Datei- und Nachrichtenversion der ganzen Historie
    pruefung.py --werte-holen    Vergleichswerte neu holen

Vergleichswerte (Geheimnisse aller Stacks, Mailadressen, Namen, Ohrmarken, Beträge) liegen nur als gesalzene
Hashes in .git/fmis-pruefung/werte.json, also nie im Repo. Sie werden dort berechnet, wo die echten Werte liegen:
Der Server (git config fmis.server) führt dieses Skript mit --server aus und liefert nur die Hashes. Fehlen sie,
wird abgelehnt. Ein Fund, der keiner ist: der Betriebsleiter entscheidet, der Fingerabdruck aus der Meldung kommt
dann in ausnahmen.txt.
"""
import base64
import binascii
import datetime as dt
import glob
import hashlib
import json
import math
import os
import pathlib
import re
import secrets
import subprocess
import sys

MIN_WERT = 8
MAX_BYTES = 2_000_000
WERTE_ALT_TAGE = 30
STACKS = os.environ.get("FMIS_STACKS", "/opt/stacks")

# --- Echte Werte einsammeln (läuft dort, wo sie liegen) ---------------------------------------------------------

NAMENSZUSAETZE = {"von", "van", "der", "den", "del", "dos", "die", "das"}
GEHEIM_NAME = re.compile(r"PASS|PWD|SECRET|TOKEN|PRIVATE|CREDENTIAL|SALT|IBAN|API_?KEY|_KEY$|^KEY|PUSH_URL", re.I)
OEFFENTLICH_NAME = re.compile(r"PUBLIC|_ID$|EXPIRE|TTL", re.I)
PLATZHALTER = re.compile(r"change|example|beispiel|placeholder|your|dummy|xxx|sample|todo|fixme|<|\$\{", re.I)
PASSWORT_IN_URL = re.compile(r"://[^/\s:@'\"]*:([^/\s@'\"]+)@")


def ernsthaft(wert: str) -> bool:
    """Taugt als Vergleichswert: Wörter wie «postgres» aus Entwicklungs-.env ergäben nur Fehlalarm."""
    if len(wert) < MIN_WERT or PLATZHALTER.search(wert) or wert.lower() in ("true", "false", "postgres", "password"):
        return False
    return len(wert) >= 12 or not wert.isalpha()


def aus_env_zeile(zeile: str) -> list[str]:
    m = re.match(r"\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$", zeile)
    if not m:
        return []
    name, wert = m.group(1), m.group(2).strip().strip("\"'")
    werte = PASSWORT_IN_URL.findall(wert)
    if GEHEIM_NAME.search(name) and not OEFFENTLICH_NAME.search(name):
        werte.append(wert)
        if "://" in wert and wert.rstrip("/").rsplit("/", 1)[-1]:      # Push-URL: das Token steckt im Pfad
            werte.append(wert.split("?")[0].rstrip("/").rsplit("/", 1)[-1])
    return [w for w in werte if ernsthaft(w)]


def geheimnisse_aus(basis: str) -> tuple[set[str], int]:
    """.env und secrets/ aller Projekte unter `basis`; zurück: Werte und Anzahl unlesbarer Dateien."""
    werte, unlesbar = set(), 0
    envs = [f for f in glob.glob(f"{basis}/*/.env*") if not re.search(r"\.(example|sample|template|dist)$", f)]
    for f in envs:
        try:
            for zeile in pathlib.Path(f).read_text(errors="ignore").splitlines():
                werte.update(aus_env_zeile(zeile))
        except OSError:
            unlesbar += 1
    for f in glob.glob(f"{basis}/*/secrets/*"):
        if not os.path.isfile(f):
            continue
        try:
            inhalt = pathlib.Path(f).read_text(errors="ignore").strip()
        except OSError:
            unlesbar += 1
            continue
        werte.update(w for w in [inhalt, *inhalt.splitlines(), *PASSWORT_IN_URL.findall(inhalt)] if ernsthaft(w.strip()))
    return {w.strip() for w in werte}, unlesbar


def ohrmarke_kern(text: str) -> str:
    """Lang- und Kurzform derselben Ohrmarke auf einen Schlüssel (CH113 + 8 Stellen + Prüfziffer bei Schafen)."""
    ziffern = re.sub(r"\D", "", text)
    return ziffern[3:11] if len(ziffern) == 12 and ziffern.startswith("113") else ziffern


def psql(stack: str, dienst: str, sql: str) -> list[list[str]]:
    befehl = f'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -AtF "\t" -c "set default_transaction_read_only=on" -c "{sql}"'
    r = subprocess.run(["docker", "compose", "exec", "-T", dienst, "sh", "-c", befehl], cwd=f"{STACKS}/{stack}", capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"{stack}: Datenbank nicht lesbar")
    return [z.split("\t") for z in r.stdout.splitlines() if z and z != "SET"]


def spalten(stack: str, dienst: str, schema_filter: str, muster: str) -> list[str]:
    zeilen = psql(stack, dienst, "select table_schema, table_name, column_name from information_schema.columns c join information_schema.tables t "
                  f"using (table_schema, table_name) where t.table_type = 'BASE TABLE' and table_schema not in ('pg_catalog','information_schema','tiger','tiger_data','topology') "
                  f"and {schema_filter} and data_type in ('text','character varying') and column_name ~* '{muster}'")
    return [f'"{s}"."{t}"."{c}"' for s, t, c in zeilen]


def werte_lesen(stack: str, dienst: str, spalte: str) -> list[str]:
    s, t, c = spalte.split(".")
    return [z[0] for z in psql(stack, dienst, f"select distinct {c} from {s}.{t} where {c} is not null")]


def betriebsdaten() -> dict[str, set[str]]:
    d: dict[str, set[str]] = {"mails": set(), "namen": set(), "ohrmarken": set(), "betraege": set(), "phrasen": set(), "nummern": set()}
    for spalte in spalten("fmis", "postgres", "true", "email"):
        d["mails"].update(w.lower() for w in werte_lesen("fmis", "postgres", spalte) if "@" in w)
    for spalte in spalten("fmis", "postgres", "true", "^ear_tag$|_ear_tag$"):
        d["ohrmarken"].update(ohrmarke_kern(w) for w in werte_lesen("fmis", "postgres", spalte) if len(re.sub(r"\D", "", w)) >= 8)
    d["namen"].update(werte_lesen("fmis", "postgres", '"betrieb"."duty_people"."name"'))
    d["nummern"].update(werte_lesen("fmis", "postgres", '"fields"."farms"."external_uid"'))
    for z in psql("fmis", "postgres", "select distinct amount from fields.dp_statement_lines where deleted_at is null and abs(amount) >= 1000"):
        d["betraege"].add(f"{abs(float(z[0])):.2f}")
    # Lohn-App: ohne eigenes Passwort, die Rolle im Container darf das
    for z in psql("zeitlohn", "db", "select first_name, last_name, email, street, birth_date from employees"):
        vor, nach, mail, strasse, geb = (z + [""] * 5)[:5]
        d["namen"].update([vor, nach])
        if "@" in mail:
            d["mails"].add(mail.lower())
        if len(strasse) >= 4:
            d["phrasen"].add(strasse.lower())
        if geb:
            t = dt.date.fromisoformat(geb)
            d["phrasen"].update({geb, t.strftime("%d.%m.%Y")})
    return d


def _h(salz: str, wert: str) -> str:
    return hashlib.sha256(f"{salz}:{wert}".encode()).hexdigest()[:32]


def _nach_laenge(salz: str, werte: set[str]) -> dict[str, list[str]]:
    aus: dict[str, list[str]] = {}
    for w in werte:
        aus.setdefault(str(len(w)), []).append(_h(salz, w))
    return aus


def hashes_bauen(salz: str, geheim: set[str], daten: dict[str, set[str]]) -> dict:
    # nur in Originalschreibung oder GROSS: klein geschrieben sind es meist gewöhnliche Wörter im Code
    woerter = {f for n in daten["namen"] for w in re.split(r"[\s-]+", n) if len(w) >= 3 and w.casefold() not in NAMENSZUSAETZE for f in (w, w.upper())}
    return {
        "geheim": _nach_laenge(salz, geheim),
        "phrasen": _nach_laenge(salz, daten["phrasen"]),
        "nummern": _nach_laenge(salz, {w for w in daten["nummern"] if len(w) >= 6}),
        "woerter": sorted(_h(salz, w) for w in woerter),
        "mails": sorted(_h(salz, w) for w in daten["mails"]),
        "ohrmarken": sorted(_h(salz, w) for w in daten["ohrmarken"]),
        "betraege": sorted(_h(salz, w) for w in daten["betraege"]),
    }


def server_modus(salz: str) -> int:
    """Läuft auf dem Server, auch ohne Repo (Skript über stdin). Gibt nur Hashes und Zähler aus."""
    geheim, unlesbar = geheimnisse_aus(STACKS)
    daten = betriebsdaten()
    aus = hashes_bauen(salz, geheim, daten)
    aus["zaehler"] = {"geheim": len(geheim), "unlesbar": unlesbar, **{k: len(v) for k, v in daten.items()}}
    print(json.dumps(aus))
    return 0


# --- Regeln ------------------------------------------------------------------------------------------------------

PFAD_VERBOTEN = re.compile(
    r"(^|/)(\.env(\.(?!example$)[^/]*)?$|secrets/|backups?/|uploads/|docs/review/|input/(?!\.gitkeep$)|id_(rsa|dsa|ecdsa|ed25519)(\.|$)|"
    r"\.(netrc|pgpass|htpasswd|npmrc|pypirc|git-credentials)$|credentials[^/]*$|docker-compose\.override\.ya?ml$|werte\.json$|namen[^/]*\.txt$)", re.I)
ENDUNG_VERBOTEN = re.compile(
    r"\.(pem|key|keystore|jks|p12|pfx|ovpn|kdbx|asc|gpg|pdf|xlsx?|xlsm|csv|tsv|docx?|odt|ods|zip|gz|tgz|tar|7z|rar|dump|bak|sqlite3?|db|mdb|shp|dbf|gpkg|log|K\d\d|Y\d\d|eml|msg)$", re.I)
BINAER_ERLAUBT = re.compile(r"\.(png|jpe?g|webp|gif|ico|woff2?|ttf)$", re.I)

KLARTEXT = r"""["'`]([^"'`\s$<{]{8,})["'`]"""
MUSTER = {
    "privater Schlüssel": re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY"),
    "Zugangstoken": re.compile(
        r"\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|sk-ant-[\w-]{20,}|sk-(proj-)?[A-Za-z0-9_-]{32,}|A(KIA|SIA)[0-9A-Z]{16}|AIza[\w-]{35}|"
        r"xox[abprs]-[\w-]{10,}|(sk|rk)_live_\w{16,}|SG\.[\w-]{16,}\.[\w-]{16,}|npm_[A-Za-z0-9]{30,}|pypi-[\w-]{30,}|\d{8,10}:AA[\w-]{30,}|hooks\.slack\.com/services/\S+)"),
    "JWT": re.compile(r"\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}"),
    "Passwort-Hash": re.compile(r"\$(2[aby]|argon2i?d?|6|5)\$[\w./=$,+-]{20,}"),
    "Passwort in URL": re.compile(r"://[^/\s:@'\"$<{`]+:[^/\s@$<{'\"`]{4,}@(?!\S*(example|localhost))"),
    "Anmeldedaten im Kopf": re.compile(r"(?i)\bauthorization\b[\"']?\s*[:=]\s*[\"'`](bearer|basic|token)\s+[A-Za-z0-9+/_=.-]{8,}"),
    "Passwort oder Schlüssel im Klartext": re.compile(
        r"(?i)(pass(word|wd|phrase)?|pwd|secret|api_?key|access_?key|private_?key|auth_?token|token|credential)[\w-]*[\"']?\s*(=|:|=>)\s*" + KLARTEXT),
    "Wert in Konfiguration": re.compile(r"(?i)^\s*[-\w]*(pass(word|wd)?|pwd|secret|api_?key|token)[-\w]*\s*[:=]\s*(?![\"'`$<{])([^\s#]{8,})\s*(#.*)?$"),
}
# Wörter, die keine Werte sind: Beispiele, Testwerte, Funktionsnamen
UNVERDAECHTIG = re.compile(r"(?i)change|example|beispiel|placeholder|your|dummy|xxx|sample|test|fake|dev-|local|geheim|secret|password|passwort|token|bitte|<|\$\{|process\.env|os\.environ|import\.meta")
ENTROPIE_FREI = re.compile(r"integrity|sha(1|256|384|512)-|data:[a-z]+/|sha256:|^\s*(<path|d=)|xmlns|fonts\.g|https?://", re.I)
KONFIG = re.compile(r"\.(ya?ml|toml|ini|conf|cfg|properties)$|(^|/)\.env[^/]*$|(^|/)Dockerfile[^/]*$", re.I)
SPERRDATEI = re.compile(r"(^|/)package-lock\.json$")
UUID = re.compile(r"^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")
MAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
MAIL_ERLAUBT = re.compile(r"@(example\.(com|org|net|ch)|beispiel\.ch|adresse\.ch|b\.ch|x\.ch|[\w.-]*riedackerhof\.(ch|localhost)|[\w.-]+\.(test|localhost|local|invalid)|anthropic\.com|test\.ch)$", re.I)
OHRMARKE = re.compile(r"\bCH[\s.]?(\d[\d\s.]{6,16}\d)\b|(?<![\d.])(\d{4}\.\d{4})(?![\d.])", re.I)
BETRAG = re.compile(r"(?<![\d.'’])(\d{1,3}(?:['’]\d{3})+|\d{4,})\.(\d{2})(?!\d)")
IBAN = re.compile(r"\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?)\b")
AHV = re.compile(r"(?<!\d)756[.\s]?\d{4}[.\s]?\d{4}[.\s]?\d{2}(?!\d)")
KARTE = re.compile(r"(?<![\d.-])(?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|3[47]\d{2})[ -]?\d{4}[ -]?\d{4}[ -]?\d{3,4}(?![\d.-])")


def iban_gueltig(s: str) -> bool:
    s = s.replace(" ", "").upper()
    if not 15 <= len(s) <= 34:
        return False
    return int("".join(str(int(c, 36)) for c in s[4:] + s[:4])) % 97 == 1


def ean13_gueltig(s: str) -> bool:
    z = [int(c) for c in re.sub(r"\D", "", s)]
    return len(z) == 13 and sum(c * (3 if i % 2 else 1) for i, c in enumerate(z)) % 10 == 0


def luhn_gueltig(s: str) -> bool:
    z = [int(c) for c in re.sub(r"\D", "", s)][::-1]
    return sum(c if i % 2 == 0 else (c * 2 - 9 if c > 4 else c * 2) for i, c in enumerate(z)) % 10 == 0


def entropie(s: str) -> float:
    return -sum(p * math.log2(p) for p in (s.count(c) / len(s) for c in set(s)))


def zufallswert(text: str) -> bool:
    """Lange Zeichenkette, die wie ein Schlüssel aussieht: Mischung statt Wort oder Bezeichner."""
    if ENTROPIE_FREI.search(text):
        return False
    for w in re.findall(r"[A-Za-z0-9+/_=-]{32,}", text):
        w = w.strip("=/-_+")
        if len(w) < 32 or UUID.match(w) or w.isalpha() or w.islower() and "-" in w or "/" in w and w.count("/") > 3:
            continue
        hexa = re.fullmatch(r"[0-9a-fA-F]+", w)
        if (hexa and entropie(w) > 3.2) or (not hexa and entropie(w) > 4.2 and any(c.isdigit() for c in w) and any(c.isupper() for c in w)):
            return True
    return False


# --- Prüfer ------------------------------------------------------------------------------------------------------


class Werte:
    """Hashes aus werte.json, dazu die .env-Dateien dieses Arbeitsverzeichnisses."""

    def __init__(self, daten: dict, lokal: set[str], erlaubt: set[str]):
        self.salz = daten["salz"]
        self.geheim = {int(k): set(v) for k, v in daten["geheim"].items()}
        for w in lokal:
            self.geheim.setdefault(len(w), set()).add(_h(self.salz, w))
        self.phrasen = {int(k): set(v) for k, v in daten["phrasen"].items()}
        self.nummern = {int(k): set(v) for k, v in daten["nummern"].items()}
        frei = {_h(self.salz, f) for w in erlaubt for f in (w, w.upper(), w.capitalize(), w.lower())}
        self.woerter = set(daten["woerter"]) - frei
        self.mails = set(daten["mails"]) - frei
        self.ohrmarken = set(daten["ohrmarken"])
        self.betraege = set(daten["betraege"])

    def _fenster(self, text: str, tabelle: dict[int, set[str]]) -> bool:
        for laenge, hashes in tabelle.items():
            for i in range(len(text) - laenge + 1):
                if _h(self.salz, text[i:i + laenge]) in hashes:
                    return True
        return False

    def arten(self, zeile: str) -> list[str]:
        h = lambda w: _h(self.salz, w)  # noqa: E731
        arten = []
        if any(self._fenster(lauf, {n: v for n, v in self.geheim.items() if n <= len(lauf)}) for lauf in zeile.split()):
            arten.append("Geheimnis aus .env oder secrets/")
        if self.phrasen and self._fenster(zeile.casefold(), self.phrasen):
            arten.append("Personendaten")
        elif any(h(w) in self.woerter for w in re.findall(r"[^\W\d_]{3,}", zeile)):
            arten.append("Personendaten")
        if any(h(m.lower()) in self.mails for m in MAIL.findall(zeile)):
            arten.append("Personendaten: Mailadresse")
        if self.nummern and any(self._fenster(lauf, self.nummern) for lauf in zeile.split()):
            arten.append("echte Betriebsnummer")
        for m in OHRMARKE.finditer(zeile):
            if h(ohrmarke_kern(m.group(0))) in self.ohrmarken:
                arten.append("echte Ohrmarke")
                break
        for m in BETRAG.finditer(zeile):
            if h(f"{re.sub(r'[^0-9]', '', m.group(1))}.{m.group(2)}") in self.betraege:
                arten.append("echter Betrag")
                break
        return arten


def muster_arten(zeile: str) -> list[str]:
    arten = []
    for art, r in MUSTER.items():
        m = r.search(zeile)
        if not m:
            continue
        if art.startswith(("Passwort oder", "Wert in")) and UNVERDAECHTIG.search(m.group(0).split(":", 1)[-1].split("=", 1)[-1]):
            continue
        arten.append(art)
    if any(iban_gueltig(m) for m in IBAN.findall(zeile)):
        arten.append("IBAN")
    if any(ean13_gueltig(m) for m in AHV.findall(zeile)):
        arten.append("AHV-Nummer")
    if any(luhn_gueltig(m) for m in KARTE.findall(zeile)):
        arten.append("Kartennummer")
    if zufallswert(zeile):
        arten.append("Zufallswert, könnte ein Schlüssel sein")
    if any(not MAIL_ERLAUBT.search(m) for m in MAIL.findall(zeile)):
        arten.append("Mailadresse")
    return arten


def fingerabdruck(pfad: str, art: str, zeile: str) -> str:
    return hashlib.sha256(f"{pfad}|{art}|{zeile.strip()}".encode()).hexdigest()[:16]


def pfad_arten(pfad: str, binaer: bool = False, groesse: int = 0) -> list[str]:
    arten = []
    if PFAD_VERBOTEN.search(pfad):
        arten.append("Pfad gehört nicht ins Repo")
    elif ENDUNG_VERBOTEN.search(pfad):
        arten.append("Dateityp gehört nicht ins Repo, könnte echte Daten enthalten")
    elif binaer and not BINAER_ERLAUBT.search(pfad):
        arten.append("Binärdatei unbekannter Art")
    if groesse > MAX_BYTES:
        arten.append(f"Datei grösser als {MAX_BYTES // 1_000_000} MB")
    return arten


class Pruefer:
    def __init__(self, werte: Werte, ausnahmen: set[str]):
        self.werte, self.ausnahmen, self.funde = werte, ausnahmen, []

    def _melde(self, ort: str, art: str, abdruck: str) -> None:
        if abdruck not in self.ausnahmen:
            self.funde.append(f"{ort}: {art} [{abdruck}]")

    def zeile(self, ort: str, pfad: str, text: str) -> None:
        for art in [*muster_arten(text), *self.werte.arten(text)]:
            if SPERRDATEI.search(pfad) and art in ("Mailadresse", "Zufallswert, könnte ein Schlüssel sein"):
                continue
            if art == "Wert in Konfiguration" and not KONFIG.search(pfad):
                continue
            self._melde(ort, art, fingerabdruck(pfad, art, text))

    def pfad(self, pfad: str, binaer: bool = False, groesse: int = 0) -> None:
        anzeige = pfad
        for art in self.werte.arten(pfad):
            self._melde("(Dateiname)", art, fingerabdruck(pfad, art, ""))
            anzeige = "(Dateiname enthält Fund)"
        for art in pfad_arten(pfad, binaer, groesse):
            self._melde(anzeige, art, fingerabdruck(pfad, art, ""))


# --- Git ---------------------------------------------------------------------------------------------------------


def git(*args: str, eingabe: bytes | None = None) -> bytes:
    return subprocess.run(["git", *args], capture_output=True, check=True, input=eingabe).stdout


def wurzel() -> pathlib.Path:
    return pathlib.Path(git("rev-parse", "--show-toplevel").decode().strip())


def werte_datei() -> pathlib.Path:
    if os.environ.get("FMIS_PRUEFUNG_WERTE"):
        return pathlib.Path(os.environ["FMIS_PRUEFUNG_WERTE"])
    return pathlib.Path(git("rev-parse", "--path-format=absolute", "--git-common-dir").decode().strip()) / "fmis-pruefung" / "werte.json"


def git_config(name: str) -> str:
    r = subprocess.run(["git", "config", "--get", name], capture_output=True, text=True)
    return r.stdout.strip()


def eigene_begriffe() -> set[str]:
    """Der eigene Name steht ohnehin in jedem Commit; dazu git config fmis.erlaubt (Wörter mit Leerzeichen getrennt)."""
    begriffe = set(re.split(r"[\s.@_-]+", git_config("user.name") + " " + git_config("user.email") + " " + git_config("fmis.erlaubt")))
    begriffe.add(git_config("user.email"))
    return {b for b in begriffe if len(b) >= 3}


def ausnahmen_lesen() -> set[str]:
    f = pathlib.Path(__file__).resolve().parent / "ausnahmen.txt"
    if not f.exists():
        return set()
    return {z.split()[0] for z in f.read_text(encoding="utf-8").splitlines() if z.strip() and not z.startswith("#")}


def pruefer_bauen() -> Pruefer:
    f = werte_datei()
    daten = json.loads(f.read_text(encoding="utf-8"))
    alter = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(daten["erstellt"])
    if alter.days > WERTE_ALT_TAGE:
        print(f"Hinweis: Vergleichswerte sind {alter.days} Tage alt. Bitte tools/git-hooks/pruefung.py --werte-holen", file=sys.stderr)
    lokal = set()
    for env in glob.glob(str(wurzel() / ".env*")):
        if not env.endswith(".example"):
            for z in pathlib.Path(env).read_text(errors="ignore").splitlines():
                lokal.update(aus_env_zeile(z))
    return Pruefer(Werte(daten, lokal, eigene_begriffe()), ausnahmen_lesen())


def werte_holen() -> int:
    server = git_config("fmis.server")
    if not server:
        print("Bitte zuerst: git config fmis.server <ssh-ziel> (auf dem Server selbst: lokal)", file=sys.stderr)
        return 1
    salz = secrets.token_hex(16)
    skript = pathlib.Path(__file__).read_bytes()
    if server == "lokal":
        r = subprocess.run([sys.executable, __file__, "--server", salz], capture_output=True)
    else:
        r = subprocess.run(["ssh", server, "python3", "-", "--server", salz], input=skript, capture_output=True, timeout=180)
    if r.returncode != 0:
        print("Vergleichswerte nicht geholt, Server meldet einen Fehler.", file=sys.stderr)
        print(r.stderr.decode(errors="ignore")[-400:], file=sys.stderr)
        return 1
    daten = json.loads(r.stdout)
    # dazu die anderen Projekte auf diesem Rechner
    lokal, unlesbar = geheimnisse_aus(str(wurzel().parent))
    z = daten.pop("zaehler")
    for w in lokal:
        daten["geheim"].setdefault(str(len(w)), []).append(_h(salz, w))
    daten.update(salz=salz, erstellt=dt.datetime.now(dt.timezone.utc).isoformat())
    f = werte_datei()
    f.parent.mkdir(mode=0o700, exist_ok=True)
    f.touch(mode=0o600)
    f.write_text(json.dumps(daten), encoding="utf-8")
    print(f"Vergleichswerte geholt. Server: {z}. Lokal: {len(lokal)} Geheimnisse, {unlesbar} Dateien unlesbar.")
    return 0


def blob_pruefen(p: Pruefer, pfad: str, inhalt: bytes, prefix: str = "") -> None:
    binaer = b"\0" in inhalt[:8192]
    p.pfad(pfad, binaer, len(inhalt))
    if binaer:
        return
    for nr, text in enumerate(inhalt.decode("utf-8", "ignore").split("\n"), 1):
        p.zeile(f"{prefix}{pfad}:{nr}", pfad, text)


def diff_pruefen(p: Pruefer, diff_args: list[str], prefix: str = "") -> None:
    """Nur hinzugefügte Zeilen und neue oder geänderte Pfade."""
    roh = git("diff", "--no-color", "--no-ext-diff", "--text", "-U0", "--diff-filter=ACMRT", *diff_args).decode("utf-8", "ignore")
    pfad, nr = None, 0
    for z in roh.split("\n"):
        if z.startswith("+++ "):
            pfad = z[6:] if z.startswith("+++ b/") else None
        elif z.startswith("@@ "):
            nr = int(re.search(r"\+(\d+)", z).group(1))
        elif z.startswith("+") and pfad:
            p.zeile(f"{prefix}{pfad}:{nr}", pfad, z[1:])
            nr += 1


def index_pruefen(p: Pruefer) -> None:
    for pfad in filter(None, git("diff", "--cached", "--name-only", "--diff-filter=ACMRT", "-z").decode().split("\0")):
        inhalt = git("show", f":{pfad}")
        p.pfad(pfad, b"\0" in inhalt[:8192], len(inhalt))
    diff_pruefen(p, ["--cached"])


def nachricht_pruefen(p: Pruefer, text: str, ort: str = "Commit-Nachricht") -> None:
    for nr, zeile in enumerate(text.split("\n"), 1):
        if not zeile.startswith("#"):
            p.zeile(f"{ort}, Zeile {nr}", "(Nachricht)", zeile)


def push_pruefen(p: Pruefer, referenzen: str) -> None:
    for zeile in referenzen.splitlines():
        teile = zeile.split()
        if len(teile) != 4 or set(teile[1]) == {"0"}:
            continue
        lokal, entfernt = teile[1], teile[3]
        bereich = [lokal, "--not", "--remotes"] if set(entfernt) == {"0"} else [f"{entfernt}..{lokal}"]
        for commit in git("rev-list", *bereich).decode().split():
            kurz = commit[:9]
            nachricht_pruefen(p, git("log", "-1", "--format=%B", commit).decode("utf-8", "ignore"), f"{kurz}, Nachricht")
            eltern = git("rev-list", "--parents", "-n1", commit).decode().split()[1:]
            basis = eltern[0] if eltern else git("hash-object", "-t", "tree", "--stdin", eingabe=b"").decode().strip()
            diff_pruefen(p, [basis, commit], f"{kurz} ")
            for pfad in filter(None, git("diff", "--name-only", "--diff-filter=ACMRT", "-z", basis, commit).decode().split("\0")):
                inhalt = git("show", f"{commit}:{pfad}")
                p.pfad(pfad, b"\0" in inhalt[:8192], len(inhalt))


def historie_pruefen(p: Pruefer) -> None:
    gesehen: dict[str, str] = {}
    for z in git("rev-list", "--all", "--objects").decode("utf-8", "ignore").splitlines():
        teile = z.split(" ", 1)
        if len(teile) == 2 and teile[0] not in gesehen:
            gesehen[teile[0]] = teile[1]
    typen = git("cat-file", "--batch-check", eingabe="\n".join(gesehen).encode()).decode().splitlines()
    for t in typen:
        sha, art = t.split()[:2]
        if art == "blob":
            blob_pruefen(p, gesehen[sha], git("cat-file", "blob", sha), f"{sha[:9]} ")
    for commit in git("rev-list", "--all").decode().split():
        nachricht_pruefen(p, git("log", "-1", "--format=%an %ae%n%B", commit).decode("utf-8", "ignore"), f"{commit[:9]}, Nachricht")


def main() -> int:
    a = sys.argv[1:]
    if a[:1] == ["--server"]:
        return server_modus(a[1])
    if a[:1] == ["--werte-holen"]:
        return werte_holen()
    try:
        p = pruefer_bauen()
    except Exception as e:
        print(f"Abgelehnt, Prüfung nicht möglich: {type(e).__name__}. Vergleichswerte holen: tools/git-hooks/pruefung.py --werte-holen", file=sys.stderr)
        return 1
    if a[:1] == ["--nachricht"]:
        nachricht_pruefen(p, pathlib.Path(a[1]).read_text(encoding="utf-8", errors="ignore"))
    elif a[:1] == ["--push"]:
        push_pruefen(p, sys.stdin.read())
    elif a[:1] == ["--alle"]:
        for pfad in filter(None, git("ls-files", "-z").decode().split("\0")):
            blob_pruefen(p, pfad, git("show", f":{pfad}"))
    elif a[:1] == ["--historie"]:
        historie_pruefen(p)
    else:
        index_pruefen(p)
    if p.funde:
        print("Abgelehnt. Bitte diese Stellen entfernen:", file=sys.stderr)
        for f in p.funde:
            print(f"  {f}", file=sys.stderr)
        print("Die Werte selbst nicht ins Gespräch oder in die Nachricht kopieren. Eine Ausnahme entscheidet der Betriebsleiter (ausnahmen.txt).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
