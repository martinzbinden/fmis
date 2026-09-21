#!/usr/bin/env python3
"""Excel-Wiesenjournal (Hauptsheet "Wiesenjournal") ins Modul Wiesenjournal
einspeisen — über die Sync-API wie tools/import_adis.py.

Struktur der Excel (Vorlage siehe Titelseite): Zeile 3 = Datum je Tages-
spalte (J…NK), ab Zeile 6 Parzellenblöcke aus je ZWEI Zeilen —
  Zeile A: B Art (Mähweide/Weide/EXWE/EXWI/OAF/KW/…), C ID (R1, OR1, WY…),
           D Name, F ha; Tageszellen = Legenden-Codes
  Zeile B: C Wiesentyp/Mischung, E Intensität (s.i./m.i./ex.); Tageszellen
           = Details (Güllemenge, Fass, Teilfläche, Ertrag, Tiergruppe)
Legende (Titelseite): X Kühe, Y Rinder, Z Kälber, G Galtkühe, W Schafe,
V Legehennen (Kleinbuchstabe = nur Tagweide), S Silage, Db/Du Dürrfutter
belüftet/unbelüftet, P Weide putzen, B/BE/BF Blacken, Ü Übersaat, H Aufwuchs-
höhe; Düngung: RGv/RGk/RMI/RMs/SG/SM/A/H/V (Modul-Codes), G Gülle, M Mist,
Kalk. Betriebszeilen: "Laufhof" X/Y/Z/V/W je Tag, "Niederschlag mm",
"Notizen", "Anzahl Tiere". Die Zeilen "Total Weidetage" sind abgeleitet
und werden übersprungen.

Parzellen: Journal-Parzellen sind GELAN-Parzellen (zuerst in der App
"Aus GELAN übernehmen" für das Jahr ausführen, oder --import-gelan). Die
Excel-Zeilen werden per normalisiertem Namen zugeordnet (ID, Name,
"ID Name"; dann eindeutiges Enthaltensein; dann --mapping JSON
{"<Excel-Schlüssel>": "<GELAN-Name oder lineage-UUID>"}). Nicht zuordenbare
Zeilen werden als Parzelle mit source='excel' (ohne Geometrie) angelegt —
in der App unter Parzellen später per "GELAN zuordnen" zusammenführen.
--report schreibt die Zuordnung als CSV.

Idempotent: deterministische UUIDs (uuid5) + import_key; Zeilen, die seit dem
Import in der App bearbeitet wurden (letzter data_history-Eintrag nicht vom
Tool), werden nur mit --force überschrieben.

Nutzung (lokal):
    python3 tools/import_wiesenjournal_xlsx.py --password "$TEST_LOGIN_PASSWORD" \\
        --report /tmp/mapping.csv "~/Downloads/riedackerhof-Daten/Wiesenjournal 2026 riedackerhof.ch.xlsx"
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import os
import re
import sys
import unicodedata
import uuid
import warnings
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_adis import Api, chunked, history_row, now_iso  # noqa: E402

try:
    import openpyxl
    from openpyxl.utils import column_index_from_string
except ImportError:  # pragma: no cover
    sys.exit("openpyxl fehlt (apt install python3-openpyxl)")

NS = uuid.UUID("6f2b9c1e-3d5a-4c7e-9b1f-2a8d4e6c0f13")  # fester Namespace für uuid5

ANIMAL_LETTER = {"X": "kuehe", "Y": "rinder", "Z": "kaelber", "G": "galtkuehe", "W": "schafe", "V": "legehennen"}
USAGE_TOKEN = {
    "S": "silage", "DB": "duerrfutter_bel", "DU": "duerrfutter_unbel", "P": "weide_putzen",
    "B": "blacken_stechen", "BE": "blacken_einzelstock", "BF": "blacken_flaeche", "Ü": "uebersaat",
    "UE": "uebersaat", "H": "aufwuchshoehe", "PFLUG": "pflug", "SAAT": "saat", "STRIEGELN": "striegeln",
    "SÄUBERUNGSSCHNITT": "saeuberungsschnitt", "SAEUBERUNGSSCHNITT": "saeuberungsschnitt", "E": "eingrasen",
}
FERT_CODES = {"RGV": "RGv", "RGK": "RGk", "RMI": "RMI", "RMS": "RMs", "SG": "SG", "SM": "SM", "A": "A"}
# Excel-Legende: G Gülle, M Mist, V NPK, Kalk (→ A mit Notiz, bis Phase 2 einen Kalk-Typ kennt)
FERT_ALIAS = {"G": "RGv", "M": "RMI", "V": "V", "KALK": "A", "H": "H"}
PARTIAL_WORDS = ("rand", "bord", "oben", "unten", "mitte", "zuoberst", "zuunterst", "um bäume", "um baeume")
INTENSITAET = {"s.i.": "i", "s.i": "i", "i": "i", "m.i.": "mi", "m.i": "mi", "mi": "mi", "ex.": "e", "ex": "e", "e": "e",
               "w.i.": "wi", "w.i": "wi", "wi": "wi"}
ART_CATEGORY = {"kw": "futter", "kunstwiese": "futter", "oaf": "acker"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.casefold())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


@dataclass
class ExcelParcel:
    key: str
    row: int
    art: str | None
    ext_id: str | None
    name: str | None
    ha: float | None
    wiesentyp: str | None
    intensitaet: str | None
    days: dict[str, tuple[list[str], list[str]]] = field(default_factory=dict)  # date → (tokens A, tokens B)

    @property
    def display(self) -> str:
        return " ".join(x for x in (self.ext_id, self.name) if x) or f"Zeile {self.row}"


@dataclass
class FarmDay:
    laufhof: dict[str, bool] = field(default_factory=dict)
    niederschlag: float | None = None
    notes: list[str] = field(default_factory=list)
    counts: dict[str, float] = field(default_factory=dict)


def split_tokens(v) -> list[str]:
    if v is None:
        return []
    s = str(v).replace("|", " ").replace("\n", " ").strip()
    return [t for t in re.split(r"\s+", s) if t]


def read_sheet(path: Path):
    warnings.filterwarnings("ignore")
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["Wiesenjournal"]
    first, last = column_index_from_string("J"), column_index_from_string("NK")
    dates: dict[int, str] = {}
    for c in range(first, last + 1):
        v = ws.cell(3, c).value
        if isinstance(v, (datetime, date)):
            dates[c] = v.strftime("%Y-%m-%d")
    year = int(next(iter(dates.values()))[:4])

    parcels: list[ExcelParcel] = []
    seen: Counter = Counter()
    r = 6
    while r <= ws.max_row:
        first_col = str(ws.cell(r, 1).value or "").strip()
        if first_col.startswith("Total"):
            break
        ext_id = ws.cell(r, 3).value
        name = ws.cell(r, 4).value
        if ext_id is None and name is None:
            r += 2
            continue
        wiesentyp = ws.cell(r + 1, 3).value
        ha = ws.cell(r, 6).value
        base = f"{str(ext_id or '').strip()}|{str(name or '').strip()}|{str(wiesentyp or '').strip()}|{ha}"
        seen[base] += 1
        key = base if seen[base] == 1 else f"{base}#{seen[base]}"
        p = ExcelParcel(
            key=key, row=r, art=str(ws.cell(r, 2).value).strip() if ws.cell(r, 2).value else None,
            ext_id=str(ext_id).strip() if ext_id else None, name=str(name).strip() if name else None,
            ha=float(ha) if isinstance(ha, (int, float)) else None,
            wiesentyp=str(wiesentyp).strip().replace("\n", " ") if wiesentyp else None,
            intensitaet=INTENSITAET.get(str(ws.cell(r + 1, 5).value or "").strip().casefold()),
        )
        for c, d in dates.items():
            a, b = split_tokens(ws.cell(r, c).value), split_tokens(ws.cell(r + 1, c).value)
            # Detailzelle als Ganzes merken (Phrasen wie "nur Bord", "1 Fass Rand")
            if a or b:
                p.days[d] = (a, [str(ws.cell(r + 1, c).value).replace("\n", " ").strip()] if b else [])
        parcels.append(p)
        r += 2

    # Betriebszeilen anhand der Beschriftung in Spalte A/C finden
    farm: dict[str, FarmDay] = defaultdict(FarmDay)
    section = None
    for rr in range(r, ws.max_row + 1):
        a = str(ws.cell(rr, 1).value or "").strip()
        c3 = str(ws.cell(rr, 3).value or "").strip().upper()
        if a in ("Laufhof", "Weide"):
            section = a
            continue
        if a.startswith("Total"):
            section = None
        if section == "Laufhof" and c3 in ANIMAL_LETTER:
            for c, d in dates.items():
                v = str(ws.cell(rr, c).value or "").strip()
                if v:
                    farm[d].laufhof[ANIMAL_LETTER[c3]] = True
        elif a.startswith("Niederschlag"):
            for c, d in dates.items():
                v = ws.cell(rr, c).value
                if isinstance(v, (int, float)):
                    farm[d].niederschlag = float(v)
        elif a == "Notizen":
            for c, d in dates.items():
                v = ws.cell(rr, c).value
                if v not in (None, ""):
                    farm[d].notes.append(str(v).strip())
        elif a == "Anzahl Tiere":
            section = "Anzahl"
        elif section == "Anzahl" and a.upper() in ANIMAL_LETTER:
            for c, d in dates.items():
                v = ws.cell(rr, c).value
                if isinstance(v, (int, float)):
                    farm[d].counts[ANIMAL_LETTER[a.upper()]] = float(v)
    return year, parcels, farm


# ---------------------------------------------------------------------------
# Token-Interpretation je (Parzelle, Tag)
# ---------------------------------------------------------------------------

@dataclass
class DayResult:
    usages: list[dict] = field(default_factory=list)
    ferts: list[dict] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)


def interpret_day(tokens_a: list[str], detail: str, fass_m3: float, ha: float | None) -> DayResult:
    res = DayResult()
    detail_l = detail.casefold()
    has_fert_detail = bool(re.search(r"m3|fass|\d+\s*:\s*\d+", detail_l))

    def add_usage(t: str, **kw):
        res.usages.append({"usage_type": t, "animal_category": None, "day_only": False, "animal_count": None,
                           "animal_group": None, "label": None, "value_num": None, "yield_amount": None,
                           "yield_unit": None, "notes": None, **kw})

    def add_fert(code: str, **kw):
        res.ferts.append({"duengung_code": code, "amount": None, "unit": "m3", "gabe_number": None, "notes": None, **kw})

    for tok in tokens_a:
        u = tok.upper().rstrip("?")
        uncertain = tok.endswith("?")
        if u in ANIMAL_LETTER and not (u == "G" and has_fert_detail) and not (u == "V" and "kg" in detail_l):
            add_usage("weide", animal_category=ANIMAL_LETTER[u], day_only=tok.islower(),
                      notes="unsicher (?)" if uncertain else None)
        elif u in FERT_CODES:
            code = FERT_CODES[u]
            add_fert(code, unit="t" if code in ("RMI", "RMs", "SM", "H") else "kg" if code in ("A", "V") else "m3")
        elif u in FERT_ALIAS:
            code = FERT_ALIAS[u]
            add_fert(code, unit="t" if code in ("RMI", "RMs", "SM", "H") else "kg" if u in ("V", "KALK") else "m3",
                     notes="Kalk" if u == "KALK" else None)
            if u == "G":
                res.decisions.append("G als Gülle (Detail enthält Menge)")
        elif u in USAGE_TOKEN:
            add_usage(USAGE_TOKEN[u], notes="unsicher (?)" if uncertain else None)
        elif re.fullmatch(r"\d+(?:[.,]\d+)?", u):
            add_usage("aufwuchshoehe", value_num=float(u.replace(",", ".")))
            res.decisions.append(f"Zahl '{tok}' in Codezeile als Aufwuchshöhe (cm) gelesen")
        elif re.fullmatch(r"\d+(?:[.,]\d+)?\s*(RB|FU|ST)", u):
            m = re.fullmatch(r"(\d+(?:[.,]\d+)?)\s*(RB|FU|ST)", u)
            add_usage("sonstig", label="Ernte", yield_amount=float(m.group(1).replace(",", ".")), yield_unit=m.group(2).lower())
        elif re.fullmatch(r"\d+(?:[.,]\d+)?\s*FASS", u) or u == "FASS":
            m = re.match(r"(\d+(?:[.,]\d+)?)", u)
            add_fert("RGv", amount=(float(m.group(1).replace(",", ".")) if m else 1) * fass_m3,
                     notes=f"{tok} à {fass_m3} m³")
        else:
            add_usage("sonstig", label=tok)
            res.decisions.append(f"unbekanntes Kürzel '{tok}' → sonstig")

    # Menge/Detail an die Düngung des Tages hängen — oder, wenn keine Düngung
    # erfasst, aber eine Menge dasteht (z.B. "1 Fass" in Zeile A fehlt),
    # Gülle annehmen.
    if detail:
        d = detail
        amount = None
        fert_notes: list[str] = []
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*m3\s*/\s*ha", d, re.I)
        if m:
            rate = float(m.group(1).replace(",", "."))
            amount = round(rate * ha, 2) if ha else None
            fert_notes.append(f"{rate} m³/ha")
            d = d[: m.start()] + d[m.end():]
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*m3", d, re.I)
        if m and amount is None:
            amount = float(m.group(1).replace(",", "."))
            d = d[: m.start()] + d[m.end():]
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*x?\s*(\d+(?:[.,]\d+)?)?\s*fass", d, re.I)
        if m and amount is None:
            n = float(m.group(1).replace(",", "."))
            if m.group(2):
                n = n * float(m.group(2).replace(",", "."))
            amount = round(n * fass_m3, 2)
            fert_notes.append(f"{m.group(0).strip()} à {fass_m3} m³")
            d = d[: m.start()] + d[m.end():]
        dil = re.search(r"(\d+)\s*:\s*(\d+)", d)
        if dil:
            fert_notes.append(f"Verdünnung {dil.group(1)}:{dil.group(2)}")
            d = d[: dil.start()] + d[dil.end():]
        # "N Fu" bei Mist = Anzahl Fuder (Menge), nicht Ertrag
        mist = next((f for f in res.ferts if f["duengung_code"] in ("RMI", "RMs", "SM")), None)
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*Fu\b", d)
        if m and mist is not None:
            fert_notes.append(f"{m.group(1)} Fuder")
            d = d[: m.start()] + d[m.end():]
        # Ertrag / Tierzahl / Tiergruppe
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*(Rb|Fu|St)\b", d)
        if m:
            harvest = next((x for x in res.usages if x["usage_type"] in ("silage", "duerrfutter_bel", "duerrfutter_unbel", "eingrasen")), None)
            if harvest is None:
                harvest = None
                for x in res.usages:
                    if x["usage_type"] == "sonstig" and x["label"] == "Ernte":
                        harvest = x
                if harvest is None:
                    res.usages.append({"usage_type": "sonstig", "animal_category": None, "day_only": False,
                                       "animal_count": None, "animal_group": None, "label": "Ernte", "value_num": None,
                                       "yield_amount": None, "yield_unit": None, "notes": None})
                    harvest = res.usages[-1]
            harvest["yield_amount"] = float(m.group(1).replace(",", "."))
            harvest["yield_unit"] = m.group(2).lower()
            d = d[: m.start()] + d[m.end():]
        m = re.search(r"(\d+)\s*(Schafe|Kühe|Rinder|Kälber|Tiere)", d, re.I)
        if m:
            cat = {"schafe": "schafe", "kühe": "kuehe", "rinder": "rinder", "kälber": "kaelber"}.get(m.group(2).casefold())
            grazing = next((x for x in res.usages if x["usage_type"] == "weide" and (cat is None or x["animal_category"] == cat)), None)
            if grazing is None and cat is not None:
                # Tierzahl nennt eine andere Kategorie als die Codezeile → eigener Weide-Eintrag
                res.usages.append({"usage_type": "weide", "animal_category": cat, "day_only": False, "animal_count": None,
                                   "animal_group": None, "label": None, "value_num": None, "yield_amount": None,
                                   "yield_unit": None, "notes": None})
                grazing = res.usages[-1]
            if grazing:
                grazing["animal_count"] = int(m.group(1))
                d = d[: m.start()] + d[m.end():]
        m = re.search(r"Saat\s*(\d+(?:[.,]\d+)?)\s*kg/ha", d, re.I)
        if m:
            seed = next((x for x in res.usages if x["usage_type"] in ("saat", "uebersaat")), None)
            if seed is None:
                res.usages.append({"usage_type": "saat", "animal_category": None, "day_only": False, "animal_count": None,
                                   "animal_group": None, "label": None, "value_num": None, "yield_amount": None,
                                   "yield_unit": None, "notes": None})
                seed = res.usages[-1]
            seed["value_num"] = float(m.group(1).replace(",", "."))
            d = d[: m.start()] + d[m.end():]
        # Wörter in der Detailzelle, die selbst Codes sind (z.B. "z", "W", "Pflug")
        rest_words = []
        for w in split_tokens(d):
            u = w.upper()
            if u in ANIMAL_LETTER and len(w) == 1:
                res.usages.append({"usage_type": "weide", "animal_category": ANIMAL_LETTER[u], "day_only": w.islower(),
                                   "animal_count": None, "animal_group": None, "label": None, "value_num": None,
                                   "yield_amount": None, "yield_unit": None, "notes": None})
            elif u in USAGE_TOKEN and u not in ("S", "H", "E", "B", "P"):
                res.usages.append({"usage_type": USAGE_TOKEN[u], "animal_category": None, "day_only": False,
                                   "animal_count": None, "animal_group": None, "label": None, "value_num": None,
                                   "yield_amount": None, "yield_unit": None, "notes": None})
            else:
                rest_words.append(w)
        rest = " ".join(rest_words).strip(" ,;")

        if res.ferts:
            f = res.ferts[0]
            if amount is not None and f["amount"] is None:
                f["amount"] = amount
            partial = any(p in detail_l for p in PARTIAL_WORDS)
            notes = fert_notes + ([f"[Teilfläche] {rest}"] if partial and rest else [rest] if rest else [])
            f["notes"] = "; ".join(n for n in [f["notes"], *notes] if n) or None
            if partial:
                res.decisions.append(f"Teilfläche: '{detail}'")
        elif amount is not None:
            res.ferts.append({"duengung_code": "RGv", "amount": amount, "unit": "m3", "gabe_number": None,
                              "notes": "; ".join(fert_notes + ([rest] if rest else [])) or None})
            res.decisions.append(f"Menge ohne Code → RGv: '{detail}'")
        elif rest:
            grazing = next((x for x in res.usages if x["usage_type"] == "weide"), None)
            target = grazing or (res.usages[0] if res.usages else None)
            if target is not None:
                if grazing and not re.search(r"\d", rest) and len(rest) < 40:
                    target["animal_group"] = rest
                else:
                    target["notes"] = "; ".join(n for n in [target["notes"], rest] if n)
            else:
                res.usages.append({"usage_type": "sonstig", "animal_category": None, "day_only": False,
                                   "animal_count": None, "animal_group": None, "label": rest[:60], "value_num": None,
                                   "yield_amount": None, "yield_unit": None, "notes": None})
    return res


# ---------------------------------------------------------------------------
# Parzellen-Zuordnung
# ---------------------------------------------------------------------------

def match_parcels(excel: list[ExcelParcel], gelan: list[dict], mapping: dict[str, str]) -> dict[str, dict | None]:
    by_norm: dict[str, list[dict]] = defaultdict(list)
    for g in gelan:
        by_norm[norm(g["name"])].append(g)
    by_lineage = {g["fields_lineage_id"]: g for g in gelan if g.get("fields_lineage_id")}
    result: dict[str, dict | None] = {}
    used: set[str] = set()
    fuzzy: list[tuple[str, str]] = []
    for p in excel:
        target = None
        m = mapping.get(p.key) or mapping.get(p.display)
        if m:
            target = by_lineage.get(m) or next((g for g in gelan if norm(g["name"]) == norm(m)), None)
        if target is None:
            cands = [x for x in (p.name, p.ext_id, f"{p.ext_id or ''} {p.name or ''}", f"{p.name or ''} {p.ext_id or ''}") if x and x.strip()]
            for c in cands:
                hits = [g for g in by_norm.get(norm(c), []) if g["id"] not in used]
                if len(hits) == 1:
                    target = hits[0]
                    break
            if target is None and p.name and len(norm(p.name)) >= 4:
                n = norm(p.name)
                hits = [g for g in gelan if g["id"] not in used and (n in norm(g["name"]) or norm(g["name"]) in n)]
                if len(hits) == 1:
                    target = hits[0]
            if target is None and p.name and len(norm(p.name)) >= 6:
                # Schreibvarianten (Kächbrunnen/Chächbrünnen, Kalberweiden/Kalberweidli)
                free = [g for g in gelan if g["id"] not in used]
                scored = sorted(
                    ((difflib.SequenceMatcher(None, norm(p.name), norm(g["name"])).ratio(), i) for i, g in enumerate(free)),
                    reverse=True,
                )
                # eindeutig: bester Treffer ≥ 0.8 und der zweitbeste deutlich schlechter
                if scored and scored[0][0] >= 0.8 and (len(scored) < 2 or scored[1][0] < 0.7):
                    target = free[scored[0][1]]
                    fuzzy.append((p.display, target["name"]))
        if target is not None:
            used.add(target["id"])
        result[p.key] = target
    for a, b in fuzzy:
        print(f"  Hinweis: '{a}' unscharf zugeordnet zu '{b}' — bitte prüfen")
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx")
    ap.add_argument("--url", default=os.environ.get("FMIS_URL", "https://fmis.riedackerhof.localhost"))
    auth = ap.add_mutually_exclusive_group()
    auth.add_argument("--password", default=os.environ.get("FMIS_TEST_PASSWORD"))
    auth.add_argument("--magic-token")
    auth.add_argument("--token", default=os.environ.get("FMIS_TOKEN"))
    ap.add_argument("--changed-by", default="import_xlsx")
    ap.add_argument("--fass-m3", type=float, default=6.5, help="Inhalt eines Güllefasses in m³")
    ap.add_argument("--mapping", help="JSON {Excel-Schlüssel: GELAN-Name oder lineage-UUID}")
    ap.add_argument("--report", help="CSV mit Parzellen-Zuordnung und Heuristik-Entscheiden")
    ap.add_argument("--import-gelan", action="store_true", help="vorher POST /wiesenjournal/parcels/import-from-fields")
    ap.add_argument("--force", action="store_true", help="auch in der App bearbeitete Zeilen überschreiben")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--insecure", action="store_true")
    args = ap.parse_args()

    year, excel, farm = read_sheet(Path(args.xlsx).expanduser())
    print(f"Excel: Saison {year}, {len(excel)} Parzellenzeilen, {sum(len(p.days) for p in excel)} Tageszellen, "
          f"{len(farm)} Betriebstage")
    mapping = json.loads(Path(args.mapping).read_text()) if args.mapping else {}

    # Interpretation (unabhängig vom Server) — für --dry-run und Report
    per_parcel_day: dict[str, dict[str, DayResult]] = {}
    decisions: list[tuple[str, str, str]] = []
    stats: Counter = Counter()
    for p in excel:
        per_parcel_day[p.key] = {}
        for d, (ta, tb) in sorted(p.days.items()):
            r = interpret_day(ta, tb[0] if tb else "", args.fass_m3, p.ha)
            per_parcel_day[p.key][d] = r
            stats["usage"] += len(r.usages)
            stats["fert"] += len(r.ferts)
            for dec in r.decisions:
                decisions.append((p.display, d, dec))
    print(f"Interpretiert: {stats['usage']} Nutzungen, {stats['fert']} Düngungen, {len(decisions)} Heuristik-Entscheide")

    api: Api | None = None
    gelan: list[dict] = []
    existing: dict[str, list[dict]] = {}
    # Auch im Dry-Run den Serverbestand holen, wenn ein Login da ist — nur so
    # lässt sich die Parzellen-Zuordnung vorab prüfen.
    if not args.dry_run or args.import_gelan or args.password or args.token or args.magic_token:
        api = Api(args.url, insecure=args.insecure)
        if args.token:
            api.token = args.token
        elif args.magic_token:
            api.login_magic(args.magic_token)
        elif args.password:
            api.login_password(args.password)
        else:
            sys.exit("Login fehlt: --password, --magic-token oder --token")
        me = api.request("GET", "/auth/me")
        print(f"Angemeldet als {me['email']} ({me.get('role')}) auf {args.url}")
        needed = {f"wiesenjournal:{a}:write" for a in ("parcels", "nutzung", "duengung", "tagesmeldung")}
        missing = needed - set(me.get("permissions", []))
        if missing:
            sys.exit(f"Fehlende Rechte: {', '.join(sorted(missing))}")
        if args.import_gelan:
            r = api.request("POST", f"/wiesenjournal/parcels/import-from-fields?year={year}")
            print(f"GELAN-Übernahme: {r}")
        existing = api.request("GET", "/wiesenjournal/sync/pull")["tables"]
        gelan = [p for p in existing.get("parcels", []) if p["season_year"] == year and not p.get("deleted_at") and p["source"] == "fields"]
        print(f"Serverbestand {year}: {len(gelan)} GELAN-Parzellen")

    matches = match_parcels(excel, gelan, mapping)
    matched = sum(1 for v in matches.values() if v)
    print(f"Zuordnung: {matched} von {len(excel)} Excel-Zeilen einer GELAN-Parzelle zugeordnet, "
          f"{len(excel) - matched} werden als Excel-Parzellen angelegt")
    for p in excel:
        g = matches[p.key]
        print(f"  {p.display:40s} {p.ha or '':>5} ha → {(g['farm_name'] + ' · ' + g['name']) if g else 'NEU (excel)'}")

    if args.report:
        with open(args.report, "w", newline="") as fh:
            w = csv.writer(fh, delimiter=";")
            w.writerow(["excel_key", "excel", "ha", "gelan", "gelan_lineage"])
            for p in excel:
                g = matches[p.key]
                w.writerow([p.key, p.display, p.ha, (g["farm_name"] + " · " + g["name"]) if g else "", g["fields_lineage_id"] if g else ""])
            w.writerow([])
            w.writerow(["parzelle", "datum", "entscheid"])
            for row in decisions:
                w.writerow(row)
        print(f"Report: {args.report}")
    if args.dry_run:
        return
    assert api is not None

    # Schutz manuell bearbeiteter Zeilen: letzter Verlaufseintrag je Zeile
    last_editor: dict[str, str | None] = {}
    for h in sorted(existing.get("data_history", []), key=lambda h: h["changed_at"]):
        last_editor[h["row_id"]] = h.get("changed_by")

    def protected(row_id: str) -> bool:
        return not args.force and row_id in last_editor and last_editor[row_id] != args.changed_by

    ts = now_iso()
    tables: dict[str, list[dict]] = {"parcels": [], "usage_entries": [], "fertilization_entries": [],
                                     "daily_farm_log": [], "data_history": []}
    existing_ids = {t: {r["id"] for r in existing.get(t, [])} for t in tables}
    skipped = Counter()

    def emit(table: str, row: dict, check: bool = True) -> None:
        if check and protected(row["id"]):
            skipped[table] += 1
            return
        row.setdefault("updated_at", ts)
        row.setdefault("deleted_at", None)
        tables[table].append(row)
        tables["data_history"].append(history_row(table, row, "update" if row["id"] in existing_ids[table] else "insert",
                                                  args.changed_by, ts))

    # Parzellen: Excel-Zeilen ohne GELAN-Treffer anlegen; bei Treffern
    # wiesentyp/intensitaet ergänzen, falls dort leer.
    parcel_id_for: dict[str, str] = {}
    max_sort = max([p.get("sort_order") or 0 for p in existing.get("parcels", [])] + [0])
    for i, p in enumerate(excel):
        g = matches[p.key]
        if g:
            parcel_id_for[p.key] = g["id"]
            if (not g.get("wiesentyp") and p.wiesentyp) or (not g.get("intensitaet") and p.intensitaet):
                # Nur leere Felder ergänzen — kein Schutz nötig (der GELAN-Import
                # schreibt diese Zeilen selbst mit dem Nutzer als changed_by).
                emit("parcels", {**g, "wiesentyp": g.get("wiesentyp") or p.wiesentyp,
                                 "intensitaet": g.get("intensitaet") or p.intensitaet, "updated_at": ts}, check=False)
        else:
            pid = str(uuid.uuid5(NS, f"excel|{year}|{p.key}"))
            parcel_id_for[p.key] = pid
            prev = next((x for x in existing.get("parcels", []) if x["id"] == pid), None)
            category = ART_CATEGORY.get((p.art or "").casefold(), "futter")
            if p.wiesentyp and re.search(r"hafer|gerste|erbsen|roggen|weizen|dinkel", p.wiesentyp, re.I):
                category = "acker"
            emit("parcels", {
                "id": pid, "season_year": year, "name": p.display, "area_a": round(p.ha * 100, 2) if p.ha else None,
                "wiesentyp": p.wiesentyp, "intensitaet": p.intensitaet, "base_geometry": None,
                "sort_order": (prev or {}).get("sort_order") or max_sort + 100 + i, "notes": (prev or {}).get("notes"),
                "source": "excel", "category": (prev or {}).get("category") or category, "farm_id": None, "farm_name": None,
                "fields_lineage_id": None, "fields_declaration_id": None, "external_kultur_id": None,
                "kultur_code": None, "kultur_name_de": None, "updated_at": ts, "deleted_at": None,
            })

    # Einträge
    for p in excel:
        pid = parcel_id_for[p.key]
        for d, r in per_parcel_day[p.key].items():
            counters: Counter = Counter()
            for u in r.usages:
                k = f"{u['usage_type']}|{u['animal_category'] or ''}"
                counters[k] += 1
                key = f"{pid}|{d}|usage|{k}|{counters[k]}"
                emit("usage_entries", {"id": str(uuid.uuid5(NS, key)), "parcel_id": pid, "entry_date": d,
                                       "paddock_version_id": None, "import_key": key, **u})
            for f in r.ferts:
                k = f"fert|{f['duengung_code']}"
                counters[k] += 1
                key = f"{pid}|{d}|{k}|{counters[k]}"
                emit("fertilization_entries", {"id": str(uuid.uuid5(NS, key)), "parcel_id": pid, "entry_date": d, **f})

    # Betriebstage
    existing_log_by_date = {r["entry_date"][:10]: r for r in existing.get("daily_farm_log", []) if not r.get("deleted_at")}
    for d, fd in sorted(farm.items()):
        prev = existing_log_by_date.get(d)
        row = {
            "id": (prev or {}).get("id") or str(uuid.uuid5(NS, f"daily|{d}")), "entry_date": d,
            "wetter_code": (prev or {}).get("wetter_code"), "mond_phase": (prev or {}).get("mond_phase"),
            "niederschlag_mm": fd.niederschlag if fd.niederschlag is not None else (prev or {}).get("niederschlag_mm"),
            "notes": "; ".join(fd.notes) if fd.notes else (prev or {}).get("notes"),
            "animal_counts": json.dumps(fd.counts) if fd.counts else (prev or {}).get("animal_counts"),
        }
        for cat in ANIMAL_LETTER.values():
            row[f"laufhof_{cat}"] = True if fd.laufhof.get(cat) else (prev or {}).get(f"laufhof_{cat}") or False
        emit("daily_farm_log", row)

    # Aufräumen: Zeilen, die ein früherer Lauf dieses Tools angelegt hat
    # (letzter Verlaufseintrag vom Tool) und die jetzt nicht mehr erzeugt
    # werden (z.B. nach Parser-Änderungen), soft-löschen.
    emitted = {t: {r["id"] for r in rows} for t, rows in tables.items()}
    for t in ("usage_entries", "fertilization_entries"):
        for r in existing.get(t, []):
            if r.get("deleted_at") or r["id"] in emitted[t] or last_editor.get(r["id"]) != args.changed_by:
                continue
            row = {**r, "deleted_at": ts, "updated_at": ts}
            tables[t].append(row)
            tables["data_history"].append(history_row(t, row, "delete", args.changed_by, ts))
            skipped[f"{t}_deleted"] += 1
    if skipped:
        print("  aufgeräumt: " + ", ".join(f"{k}: {n}" for k, n in skipped.items() if k.endswith("_deleted")))

    for t, rows in tables.items():
        print(f"  sende {t}: {len(rows)}" + (f" (übersprungen, in der App bearbeitet: {skipped[t]})" if skipped[t] else ""))
    accepted: Counter = Counter()
    for table in ["parcels", "usage_entries", "fertilization_entries", "daily_farm_log", "data_history"]:
        for batch in chunked(tables[table], 500):
            resp = api.request("POST", "/wiesenjournal/sync/push", {"tables": {table: batch}})
            for t, n in resp["accepted"].items():
                accepted[t] += n
    print("Übernommen: " + ", ".join(f"{t}: {n}" for t, n in accepted.items()))


if __name__ == "__main__":
    main()
