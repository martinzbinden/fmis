#!/usr/bin/env python3
"""Herdebuch-Export (ADIS, "Datenschnittstelle Rindvieh-Schweiz", Qualitas AG)
von der Kommandozeile in eine dairy-Instanz einspeisen — ohne Browser.

Macht dasselbe wie der Import unter "Tiere" in der App
(modules/dairy/frontend/src/lib/importAdis.ts), aber serverseitig über die
normale Sync-API (POST /<instanz>/sync/push): Rechteprüfung, Last-Write-
Wins und der Verlauf (data_history) laufen damit exakt wie bei einem Import
aus dem Browser; alle Clients bekommen die Daten beim nächsten Pull.
Spaltenoffsets 1:1 aus der Spec (Version 4.35) bzw. importAdis.ts —
bei Änderungen BEIDE Stellen nachziehen.

Reines Python-Standardbibliothek-Skript (kein pip install nötig).

Nutzung (lokal, Test-Login):
    python3 tools/import_adis.py --instance dairy_schafe \\
        --url https://fmis.riedackerhof.localhost --password "$TEST_LOGIN_PASSWORD" \\
        ~/Downloads/stammdatenbetrieb2109939zbindenmartin.zip

Nutzung (Produktion, mit dem Token aus dem eigenen Login-Link
".../verify?token=<TOKEN>" — der Link ist persistent, siehe README):
    python3 tools/import_adis.py --instance dairy \\
        --url https://fmis.riedackerhof.ch --magic-token "<TOKEN>" \\
        ~/Downloads/stammdatenbetrieb3347044zbindenalfred.zip

Eingabe: ein oder mehrere ZIPs, Verzeichnisse oder einzelne Dateien. Die
Satzart steht in den ersten 3 Zeichen JEDER ZEILE, nicht im Dateinamen —
gebraucht werden K01 (Tier-Stammdaten, liegt in *.Y01), K33 (alle
Milchwägungen) und K04 (Laktationsabschlüsse); alles andere wird ignoriert.

Wiederholter Import ist idempotent: Tiere werden per Ohrmarke, Milchtests
per (Tier, Datum), Laktationen per (Tier, Laktationsnummer, Abschlussart)
mit dem Serverbestand abgeglichen. --dry-run parst nur und zeigt, was
gesendet würde. --insecure für selbstsignierte Zertifikate ohne CA im
System-Truststore (lokal mit mkcert normalerweise nicht nötig).
"""

from __future__ import annotations

import argparse
import json
import os
import ssl
import sys
import urllib.error
import urllib.request
import uuid
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Parser — Offsets 1-indexiert, inklusive (wie in der Spec).
# ---------------------------------------------------------------------------


def field(line: str, start: int, end: int) -> str:
    return line[start - 1 : end]


def trimmed(s: str) -> str | None:
    t = s.strip()
    return t or None


def adis_date(s: str) -> str | None:
    t = s.strip()
    if len(t) != 8 or not t.isdigit():
        return None
    return f"{t[0:4]}-{t[4:6]}-{t[6:8]}"


def adis_number(s: str) -> float | None:
    t = s.strip()
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def adis_int(s: str) -> int | None:
    t = s.strip()
    if not t:
        return None
    try:
        return int(t)
    except ValueError:
        return None


@dataclass
class Animal:
    ear_tag: str
    name: str | None
    breed_code: str | None
    birth_date: str | None
    sex: str | None
    status: str
    entry_date: str | None
    exit_date: str | None
    lauf_nr: str | None  # "Laufnummer in Herde" (K01 283-286)


@dataclass
class MilkTest:
    ear_tag: str
    test_date: str
    calving_date: str | None
    lactation_number: int | None
    milk_kg: float
    # None = Wägung ohne Laboranalyse (nur kg Milch), siehe schema/0004.
    fat_pct: float | None
    protein_pct: float | None
    lactose_pct: float | None
    cell_count: int | None
    urea_mg_dl: int | None


@dataclass
class Lactation:
    ear_tag: str
    lactation_number: int
    calving_date: str | None
    closure_type: int
    days_in_milk: int | None
    milk_kg: int | None
    fat_kg: int | None
    fat_pct: float | None
    protein_kg: int | None
    protein_pct: float | None


def parse_k01(line: str) -> Animal | None:
    ear_tag = trimmed(field(line, 23, 36))
    if not ear_tag:
        return None
    exit_date = adis_date(field(line, 138, 145))
    sex_code = field(line, 112, 112)
    return Animal(
        ear_tag=ear_tag,
        name=trimmed(field(line, 40, 51)),
        breed_code=trimmed(field(line, 37, 39)),
        birth_date=adis_date(field(line, 52, 59)),
        sex="m" if sex_code == "1" else "w" if sex_code == "2" else None,
        status="abgegangen" if exit_date else "aktiv",
        entry_date=adis_date(field(line, 130, 137)),
        exit_date=exit_date,
        lauf_nr=trimmed(field(line, 283, 286)),
    )


def parse_k33(line: str) -> MilkTest | None:
    ear_tag = trimmed(field(line, 23, 36))
    test_date = adis_date(field(line, 82, 89))
    milk_kg = adis_number(field(line, 90, 93))
    fat_pct = adis_number(field(line, 94, 97))
    protein_pct = adis_number(field(line, 98, 101))
    # Fett/Eiweiss dürfen fehlen (Wägung ohne Laboranalyse).
    if not ear_tag or not test_date or milk_kg is None:
        return None
    return MilkTest(
        ear_tag=ear_tag,
        test_date=test_date,
        calving_date=adis_date(field(line, 69, 76)),
        lactation_number=adis_int(field(line, 77, 78)),
        milk_kg=milk_kg,
        fat_pct=fat_pct,
        protein_pct=protein_pct,
        lactose_pct=adis_number(field(line, 102, 105)),
        cell_count=adis_int(field(line, 109, 112)),
        urea_mg_dl=adis_int(field(line, 113, 115)),
    )


def parse_k04(line: str) -> Lactation | None:
    ear_tag = trimmed(field(line, 23, 36))
    lactation_number = adis_int(field(line, 69, 70))
    closure_type = adis_int(field(line, 84, 84))
    milk_kg = adis_int(field(line, 89, 93))
    # Tier-Kopfzeile (Laktation 0, keine Werte) fällt über milk_kg raus.
    if not ear_tag or lactation_number is None or closure_type is None or milk_kg is None:
        return None
    return Lactation(
        ear_tag=ear_tag,
        lactation_number=lactation_number,
        calving_date=adis_date(field(line, 71, 78)),
        closure_type=closure_type,
        days_in_milk=adis_int(field(line, 85, 88)),
        milk_kg=milk_kg,
        fat_kg=adis_int(field(line, 94, 97)),
        fat_pct=adis_number(field(line, 98, 101)),
        protein_kg=adis_int(field(line, 102, 105)),
        protein_pct=adis_number(field(line, 106, 109)),
    )


@dataclass
class ParseResult:
    animals: list[Animal]
    milk_tests: list[MilkTest]
    lactations: list[Lactation]
    warnings: list[str]
    ignored_lines: int


def parse_text(name: str, text: str, result: ParseResult) -> None:
    for line in text.splitlines():
        if not line.strip():
            continue
        tag = line[:3]
        if tag == "K01":
            a = parse_k01(line)
            if a:
                result.animals.append(a)
            else:
                result.warnings.append(f"{name}: K01-Zeile ohne Ohrmarke übersprungen")
        elif tag == "K33":
            m = parse_k33(line)
            if m:
                result.milk_tests.append(m)
            else:
                result.warnings.append(f"{name}: K33-Zeile mit fehlenden Pflichtwerten übersprungen")
        elif tag == "K04":
            l = parse_k04(line)
            if l:
                result.lactations.append(l)
        else:
            result.ignored_lines += 1


def decode(data: bytes) -> str:
    # Die Exporte sind Latin-1 (Umlaute in Namen/Adressen), nicht UTF-8.
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def collect_inputs(paths: list[str]) -> list[tuple[str, str]]:
    """Liefert (Name, Inhalt) für jede Datei in ZIPs/Verzeichnissen/Einzeldateien."""
    out: list[tuple[str, str]] = []
    for p in paths:
        path = Path(p)
        if not path.exists():
            sys.exit(f"Nicht gefunden: {path}")
        if path.is_dir():
            for f in sorted(path.rglob("*")):
                if f.is_file():
                    out.append((f.name, decode(f.read_bytes())))
        elif path.suffix.lower() == ".zip":
            with zipfile.ZipFile(path) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    out.append((f"{path.name}:{info.filename}", decode(zf.read(info))))
        else:
            out.append((path.name, decode(path.read_bytes())))
    return out


# ---------------------------------------------------------------------------
# API-Client
# ---------------------------------------------------------------------------


class Api:
    def __init__(self, base_url: str, insecure: bool = False) -> None:
        self.base_url = base_url.rstrip("/")
        self.token: str | None = None
        self.ctx = ssl.create_default_context()
        if insecure:
            self.ctx.check_hostname = False
            self.ctx.verify_mode = ssl.CERT_NONE

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            sys.exit(f"{method} {path} -> HTTP {e.code}: {detail}")

    def login_password(self, password: str) -> None:
        self.token = self.request("POST", "/auth/password-login", {"password": password})["access_token"]

    def login_magic(self, token: str) -> None:
        self.token = self.request("POST", "/auth/verify", {"token": token})["access_token"]


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def history_row(table: str, row: dict, action: str, changed_by: str, ts: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "table_name": table,
        "row_id": row["id"],
        "action": action,
        "changed_by": changed_by,
        "changed_at": ts,
        "snapshot": json.dumps(row, ensure_ascii=False),
        "updated_at": ts,
    }


def build_rows(parsed: ParseResult, existing: dict[str, list[dict]], changed_by: str) -> dict[str, list[dict]]:
    ts = now_iso()
    tables: dict[str, list[dict]] = {"animals": [], "milk_tests": [], "lactations": [], "data_history": []}

    ear_tag_to_id = {a["ear_tag"]: a["id"] for a in existing.get("animals", [])}
    for a in parsed.animals:
        is_new = a.ear_tag not in ear_tag_to_id
        row_id = ear_tag_to_id.setdefault(a.ear_tag, str(uuid.uuid4()))
        row = {"id": row_id, **asdict(a), "notes": None, "updated_at": ts, "deleted_at": None}
        # notes gehört nicht zum Export — bestehende Notizen (und eine in der
        # App gesetzte Laufnummer) nicht überschreiben.
        if not is_new:
            prev = next(r for r in existing["animals"] if r["id"] == row_id)
            row["notes"] = prev.get("notes")
            row["lauf_nr"] = a.lauf_nr or prev.get("lauf_nr")
        tables["animals"].append(row)
        tables["data_history"].append(history_row("animals", row, "insert" if is_new else "update", changed_by, ts))

    unmatched: set[str] = set()

    test_key_to_id = {f'{t["animal_id"]}|{t["test_date"]}': t["id"] for t in existing.get("milk_tests", [])}
    for m in parsed.milk_tests:
        animal_id = ear_tag_to_id.get(m.ear_tag)
        if not animal_id:
            unmatched.add(m.ear_tag)
            continue
        key = f"{animal_id}|{m.test_date}"
        is_new = key not in test_key_to_id
        row_id = test_key_to_id.setdefault(key, str(uuid.uuid4()))
        d = asdict(m)
        d.pop("ear_tag")
        row = {"id": row_id, "animal_id": animal_id, **d, "updated_at": ts, "deleted_at": None}
        tables["milk_tests"].append(row)
        tables["data_history"].append(history_row("milk_tests", row, "insert" if is_new else "update", changed_by, ts))

    lact_key_to_id = {
        f'{l["animal_id"]}|{l["lactation_number"]}|{l["closure_type"]}': l["id"]
        for l in existing.get("lactations", [])
    }
    for l in parsed.lactations:
        animal_id = ear_tag_to_id.get(l.ear_tag)
        if not animal_id:
            unmatched.add(l.ear_tag)
            continue
        key = f"{animal_id}|{l.lactation_number}|{l.closure_type}"
        is_new = key not in lact_key_to_id
        row_id = lact_key_to_id.setdefault(key, str(uuid.uuid4()))
        d = asdict(l)
        d.pop("ear_tag")
        row = {"id": row_id, "animal_id": animal_id, **d, "updated_at": ts, "deleted_at": None}
        tables["lactations"].append(row)
        tables["data_history"].append(history_row("lactations", row, "insert" if is_new else "update", changed_by, ts))

    if unmatched:
        print(f"Hinweis: {len(unmatched)} Ohrmarken ohne Tier-Stammdaten übersprungen: {', '.join(sorted(unmatched))}")
    return tables


def chunked(rows: list[dict], size: int):
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="ZIP(s), Verzeichnis(se) oder einzelne Exportdateien")
    ap.add_argument("--instance", required=True, choices=["dairy", "dairy_schafe"],
                    help="Ziel-Instanz: dairy (Milchkühe) oder dairy_schafe (Milchschafe)")
    ap.add_argument("--url", default=os.environ.get("FMIS_URL", "https://fmis.riedackerhof.localhost"),
                    help="Basis-URL der App (Default: $FMIS_URL oder lokale Instanz)")
    auth = ap.add_mutually_exclusive_group()
    auth.add_argument("--password", default=os.environ.get("FMIS_TEST_PASSWORD"),
                      help="TEST_LOGIN_PASSWORD (nur Test-Umgebungen; Default: $FMIS_TEST_PASSWORD)")
    auth.add_argument("--magic-token", help="Token aus dem Login-Link (.../verify?token=...)")
    auth.add_argument("--token", default=os.environ.get("FMIS_TOKEN"), help="fertiges Session-JWT (Default: $FMIS_TOKEN)")
    ap.add_argument("--changed-by", default="import_adis", help="Wert für data_history.changed_by")
    ap.add_argument("--batch", type=int, default=500, help="Zeilen pro Push-Request")
    ap.add_argument("--dry-run", action="store_true", help="nur parsen und zusammenfassen, nichts senden")
    ap.add_argument("--insecure", action="store_true", help="TLS-Zertifikat nicht prüfen")
    args = ap.parse_args()

    files = collect_inputs(args.inputs)
    parsed = ParseResult([], [], [], [], 0)
    for name, text in files:
        parse_text(name, text, parsed)

    without_analysis = sum(1 for m in parsed.milk_tests if m.fat_pct is None or m.protein_pct is None)
    print(f"Geparst: {len(parsed.animals)} Tiere, {len(parsed.milk_tests)} Milchtests "
          f"(davon {without_analysis} ohne Laboranalyse), "
          f"{len(parsed.lactations)} Laktationen ({parsed.ignored_lines} andere Zeilen ignoriert)")
    # Gleiche Warnungen zusammenfassen.
    from collections import Counter
    for w, n in Counter(parsed.warnings).items():
        print(f"  Warnung: {w}" + (f" ({n}x)" if n > 1 else ""))
    if not parsed.animals:
        sys.exit("Keine K01-Tierstammdaten gefunden — falsche Dateien?")

    breeds = sorted({a.breed_code or "?" for a in parsed.animals})
    print(f"Rassen im Export: {', '.join(breeds)}")

    if args.dry_run:
        tables = build_rows(parsed, {}, args.changed_by)
        for t, rows in tables.items():
            print(f"  würde senden: {t}: {len(rows)}")
        return

    api = Api(args.url, insecure=args.insecure)
    if args.token:
        api.token = args.token
    elif args.magic_token:
        api.login_magic(args.magic_token)
    elif args.password:
        api.login_password(args.password)
    else:
        sys.exit("Login fehlt: --password, --magic-token oder --token angeben")

    me = api.request("GET", "/auth/me")
    print(f"Angemeldet als {me['email']} ({me.get('role')}) auf {args.url}, Instanz {args.instance}")
    needed = {f"{args.instance}:animals:write", f"{args.instance}:milk:write"}
    missing = needed - set(me.get("permissions", []))
    if missing:
        sys.exit(f"Fehlende Rechte: {', '.join(sorted(missing))}")

    existing = api.request("GET", f"/{args.instance}/sync/pull")["tables"]
    print(f"Serverbestand: {len(existing.get('animals', []))} Tiere, "
          f"{len(existing.get('milk_tests', []))} Milchtests, {len(existing.get('lactations', []))} Laktationen")

    tables = build_rows(parsed, existing, args.changed_by)

    # Reihenfolge wichtig (Fremdschlüssel): Tiere vor Milchtests/Laktationen,
    # History zuletzt. Jede Tabelle in Batches, damit ein Request nicht
    # riesig wird (Martins K33 hat >1000 Zeilen).
    accepted: dict[str, int] = {}
    for table in ["animals", "milk_tests", "lactations", "data_history"]:
        for batch in chunked(tables[table], args.batch):
            resp = api.request("POST", f"/{args.instance}/sync/push", {"tables": {table: batch}})
            for t, n in resp["accepted"].items():
                accepted[t] = accepted.get(t, 0) + n
    print("Übernommen: " + ", ".join(f"{t}: {n}" for t, n in accepted.items()))


if __name__ == "__main__":
    main()
