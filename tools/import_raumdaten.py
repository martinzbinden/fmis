#!/usr/bin/env python3
"""Kantonaler "Raumdatenexport Bewirtschafter" (ZIP mit ESRI-Shapefiles,
EPSG:2056) von der Kommandozeile ins Modul Kulturen (fields) einspeisen —
ohne Browser.

Gegenstück zu "Karte → Raumdaten importieren" in der App
(modules/fields/frontend/src/lib/importFields.ts): gleiche 4 Layer, gleiche
Attribut-Zuordnung, gleiche Abgleichschlüssel (Betrieb per UID,
Bewirtschaftungseinheit per (Betrieb, ID BewE, Jahr), Kulturfläche per
(Betrieb, ID Kultur, Jahr)), gleiche lineage_id-Vererbung über die Jahre,
gleiche Projektionsdefinition (proj-String 1:1 übernommen, damit die
Geometrien mit einem Browser-Import identisch sind). Geschrieben wird über
die normale Sync-API (POST /fields/sync/push) — Rechte, Last-Write-Wins
und der Verlauf (data_history) laufen also exakt wie in der App, alle
Clients bekommen die Daten beim nächsten Pull.

Im Unterschied zum Browser-Import bleiben bei einem Re-Import manuell
gepflegte Felder (notes, sorte, start_date, end_date) einer bestehenden
Kulturfläche erhalten.

Abhängigkeiten (Debian/Ubuntu: `apt install python3-gdal python3-pyproj`):
GDAL-Python-Bindings (Shapefile-Leser) und pyproj (Reprojektion). Der Rest
ist Standardbibliothek; Login/HTTP kommt aus tools/import_adis.py.

Nutzung (lokal, Test-Login; mehrere ZIPs/Jahre/Betriebe auf einmal):
    python3 tools/import_raumdaten.py --password "$TEST_LOGIN_PASSWORD" \\
        ~/Downloads/riedackerhof-Daten/raumdatenexport_bewirtschafter_*.zip

Produktion: --url https://fmis.riedackerhof.ch --magic-token "<TOKEN>"
(Token aus dem eigenen Login-Link .../verify?token=...). --dry-run parst
und fasst nur zusammen. Reihenfolge der ZIPs ist egal, es wird nach Jahr
sortiert importiert, damit die lineage_id vom ältesten Jahr her vererbt wird.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from import_adis import Api, chunked, history_row, now_iso  # noqa: E402

try:
    from osgeo import gdal, ogr
    from pyproj import CRS, Transformer
except ImportError as e:  # pragma: no cover
    sys.exit(f"Fehlende Abhängigkeit ({e}). Debian/Ubuntu: apt install python3-gdal python3-pyproj")

gdal.UseExceptions()

# 1:1 aus modules/fields/frontend/src/lib/importFields.ts — bewusst derselbe
# String (inkl. towgs84-Parameter), nicht EPSG:2056 aus der PROJ-Datenbank,
# damit CLI- und Browser-Import auf den Meter identische Koordinaten liefern.
CH1903_LV95 = (
    "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 "
    "+k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel "
    "+towgs84=674.4,15.1,405.3,0,0,0,0 +units=m +no_defs"
)
WGS84 = "+proj=longlat +datum=WGS84 +no_defs"
_transformer = Transformer.from_crs(CRS.from_proj4(CH1903_LV95), CRS.from_proj4(WGS84), always_xy=True)

LAYER_NAMES = [
    "betrieb_betrieb",
    "betrieb_bewirtschaftungseinheit",
    "lnf_nutzung_flaeche",
    "lnf_nutzung_punkt",
]


def map_coordinates(coords):
    if isinstance(coords, list) and coords and isinstance(coords[0], (int, float)):
        x, y = _transformer.transform(coords[0], coords[1])
        return [x, y]
    if isinstance(coords, list):
        return [map_coordinates(c) for c in coords]
    return coords


def read_layers(zip_path: Path) -> dict[str, list[dict]]:
    """Liest die 4 Shapefile-Layer direkt aus dem ZIP (GDAL /vsizip/), gibt
    pro Layer eine Liste von {properties, geometry(GeoJSON, WGS84)}."""
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    result: dict[str, list[dict]] = {}
    # Kein .cpg im Export; Textfelder sind windows-1252 (siehe importFields.ts).
    gdal.SetConfigOption("SHAPE_ENCODING", "CP1252")
    for layer in LAYER_NAMES:
        shp = next((n for n in names if n.lower().endswith(f"/{layer}.shp") or n.lower() == f"{layer}.shp"), None)
        if not shp:
            continue
        ds = ogr.Open(f"/vsizip/{zip_path}/{shp}")
        if ds is None:
            continue
        lyr = ds.GetLayer(0)
        features = []
        for feat in lyr:
            props = {lyr.GetLayerDefn().GetFieldDefn(i).GetName(): feat.GetField(i)
                     for i in range(lyr.GetLayerDefn().GetFieldCount())}
            geom = feat.GetGeometryRef()
            geojson = None
            if geom is not None:
                geom.FlattenTo2D()
                g = json.loads(geom.ExportToJson())
                g["coordinates"] = map_coordinates(g["coordinates"])
                geojson = g
            features.append({"properties": props, "geometry": geojson})
        result[layer] = features
    return result


def field(props: dict, *names: str):
    for n in names:
        if n in props and props[n] is not None:
            return props[n]
    return None


def s(v) -> str | None:
    if v is None:
        return None
    t = str(v).strip()
    return t or None


def num(v) -> float | None:
    if v is None or str(v).strip() == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_int(v) -> int | None:
    n = num(v)
    return None if n is None else round(n)


def parse_kultur_name(v) -> tuple[str | None, str | None]:
    try:
        entries = json.loads(str(v))
        de = next((e["Text"] for e in entries if e.get("Language") == "de"), None)
        fr = next((e["Text"] for e in entries if e.get("Language") == "fr"), None)
        return de, fr
    except (ValueError, TypeError, AttributeError):
        return None, None


def export_year(layers: dict[str, list[dict]]) -> int:
    for f in layers.get("lnf_nutzung_flaeche", []) + layers.get("betrieb_bewirtschaftungseinheit", []):
        y = to_int(field(f["properties"], "Jahr", "JAHR"))
        if y:
            return y
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("zips", nargs="+", help="Raumdatenexport-ZIP(s), ein ZIP pro Betrieb und Jahr")
    ap.add_argument("--url", default=os.environ.get("FMIS_URL", "https://fmis.riedackerhof.localhost"))
    auth = ap.add_mutually_exclusive_group()
    auth.add_argument("--password", default=os.environ.get("FMIS_TEST_PASSWORD"))
    auth.add_argument("--magic-token")
    auth.add_argument("--token", default=os.environ.get("FMIS_TOKEN"))
    ap.add_argument("--changed-by", default="import_raumdaten")
    ap.add_argument("--batch", type=int, default=200, help="Zeilen pro Push-Request (Geometrien sind gross)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--insecure", action="store_true")
    args = ap.parse_args()

    # Nach Jahr sortieren: lineage_id wird vom ältesten Vorkommen einer
    # ID Kultur vererbt — so wie es auch bei jährlichem Browser-Import wäre.
    parsed = []
    for z in args.zips:
        p = Path(z)
        if not p.exists():
            sys.exit(f"Nicht gefunden: {p}")
        layers = read_layers(p)
        if not layers.get("betrieb_betrieb"):
            print(f"{p.name}: Layer betrieb_betrieb nicht gefunden — übersprungen")
            continue
        parsed.append((export_year(layers), p, layers))
    parsed.sort(key=lambda t: (t[0], t[1].name))
    for year, p, layers in parsed:
        b = layers["betrieb_betrieb"][0]["properties"]
        print(f"{p.name}: Jahr {year}, Betrieb {s(field(b, 'Name'))} (UID {s(field(b, 'UID'))}), "
              f"{len(layers.get('betrieb_bewirtschaftungseinheit', []))} BewE, "
              f"{len(layers.get('lnf_nutzung_flaeche', []))} Flächen, {len(layers.get('lnf_nutzung_punkt', []))} Punkte")
    if not parsed:
        sys.exit("Nichts zu importieren.")

    if args.dry_run:
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
    print(f"Angemeldet als {me['email']} ({me.get('role')}) auf {args.url}")
    if "fields:fields:write" not in me.get("permissions", []):
        sys.exit("Fehlendes Recht: fields:fields:write")

    existing = api.request("GET", "/fields/sync/pull")["tables"]
    ex_farms = [r for r in existing.get("farms", []) if not r.get("deleted_at")]
    ex_units = [r for r in existing.get("management_units", []) if not r.get("deleted_at")]
    ex_decls = [r for r in existing.get("field_declarations", []) if not r.get("deleted_at")]
    print(f"Serverbestand: {len(ex_farms)} Betriebe, {len(ex_units)} BewE, {len(ex_decls)} Kulturflächen")

    farms_by_uid = {r["external_uid"]: r["id"] for r in ex_farms if r.get("external_uid")}
    units_by_key = {f'{r["farm_id"]}|{r["external_id"]}|{r["jahr"]}': r["id"] for r in ex_units}
    decl_by_key = {
        f'{r["farm_id"]}|{r.get("external_kultur_id") or ""}|{r["jahr"]}|{r["sequence_in_year"]}': r
        for r in ex_decls
    }
    lineage_by_kultur: dict[str, str] = {}
    for r in sorted(ex_decls, key=lambda r: r["jahr"]):
        if r.get("external_kultur_id"):
            lineage_by_kultur.setdefault(f'{r["farm_id"]}|{r["external_kultur_id"]}', r["lineage_id"])

    ts = now_iso()
    tables: dict[str, list[dict]] = {"farms": [], "management_units": [], "field_declarations": [], "data_history": []}
    seen_farm_ids: set[str] = set()

    def emit(table: str, row: dict, is_new: bool) -> None:
        tables[table].append(row)
        tables["data_history"].append(history_row(table, row, "insert" if is_new else "update", args.changed_by, ts))

    for year, p, layers in parsed:
        bp = layers["betrieb_betrieb"][0]["properties"]
        uid = s(field(bp, "UID"))
        if not uid:
            print(f"{p.name}: Betrieb ohne UID — übersprungen")
            continue
        is_new_farm = uid not in farms_by_uid
        farm_id = farms_by_uid.setdefault(uid, str(uuid.uuid4()))
        if farm_id not in seen_farm_ids:
            seen_farm_ids.add(farm_id)
            emit("farms", {
                "id": farm_id, "external_uid": uid, "bur_nr": s(field(bp, "BUR_NR")),
                "name": s(field(bp, "Name")) or uid, "updated_at": ts, "deleted_at": None,
            }, is_new_farm)

        for f in layers.get("betrieb_bewirtschaftungseinheit", []):
            up = f["properties"]
            ext = s(field(up, "ID_BewE", "ID BewE"))
            jahr = to_int(field(up, "JAHR", "Jahr"))
            if not ext or jahr is None:
                print(f"{p.name}: Bewirtschaftungseinheit ohne ID/Jahr übersprungen")
                continue
            key = f"{farm_id}|{ext}|{jahr}"
            is_new = key not in units_by_key
            row_id = units_by_key.setdefault(key, str(uuid.uuid4()))
            emit("management_units", {
                "id": row_id, "farm_id": farm_id, "external_id": ext, "jahr": jahr,
                "gemeinde_bfs_nr": s(field(up, "Gemeinde")), "zone": s(field(up, "Zone")),
                "name": s(field(up, "Name_BewE", "Name BewE")),
                "area_total_a": num(field(up, "Fl_Total", "Fl Total")),
                "area_unprod_a": num(field(up, "Fl_Unprod", "Fl Unprod")),
                "area_wald_a": num(field(up, "Fl_Wald", "Fl Wald")),
                "area_land_a": num(field(up, "Fl_Land", "Fl Land")),
                "updated_at": ts, "deleted_at": None,
            }, is_new)

        for f in layers.get("lnf_nutzung_flaeche", []) + layers.get("lnf_nutzung_punkt", []):
            fp = f["properties"]
            ext_kultur = s(field(fp, "ID_Kultur", "ID Kultur"))
            jahr = to_int(field(fp, "Jahr", "JAHR"))
            kultur = s(field(fp, "Kultur"))
            if not kultur or jahr is None:
                print(f"{p.name}: Kulturfläche ohne Kultur-Code/Jahr übersprungen")
                continue
            seq = 1
            key = f"{farm_id}|{ext_kultur or ''}|{jahr}|{seq}"
            prev = decl_by_key.get(key)
            row_id = prev["id"] if prev else str(uuid.uuid4())
            lineage_key = f"{farm_id}|{ext_kultur}" if ext_kultur else None
            lineage_id = (lineage_key and lineage_by_kultur.get(lineage_key)) or (prev or {}).get("lineage_id") or str(uuid.uuid4())
            if lineage_key:
                lineage_by_kultur.setdefault(lineage_key, lineage_id)
            de, fr = parse_kultur_name(field(fp, "Kultur_Nam", "Kultur_Name"))
            row = {
                "id": row_id, "farm_id": farm_id, "lineage_id": lineage_id,
                "management_unit_external_id": s(field(fp, "ID_BewE", "ID BewE")),
                "external_kultur_id": ext_kultur, "jahr": jahr, "sequence_in_year": seq,
                "kultur_code": kultur, "kultur_name_de": de, "kultur_name_fr": fr,
                "flurname": s(field(fp, "Flurname")), "area_a": num(field(fp, "Fl_Land", "Fl Land")),
                "baeume": to_int(field(fp, "Baeume")),
                "geometry": json.dumps(f["geometry"]) if f["geometry"] else None,
                "source": "import",
                # Manuell gepflegte Felder eines bestehenden Eintrags nicht verlieren.
                "notes": (prev or {}).get("notes"), "start_date": (prev or {}).get("start_date"),
                "end_date": (prev or {}).get("end_date"), "sorte": (prev or {}).get("sorte"),
                "updated_at": ts, "deleted_at": None,
            }
            decl_by_key[key] = row
            emit("field_declarations", row, prev is None)

    for t, rows in tables.items():
        print(f"  sende {t}: {len(rows)}")
    accepted: dict[str, int] = {}
    for table in ["farms", "management_units", "field_declarations", "data_history"]:
        for batch in chunked(tables[table], args.batch):
            resp = api.request("POST", "/fields/sync/push", {"tables": {table: batch}})
            for t, n in resp["accepted"].items():
                accepted[t] = accepted.get(t, 0) + n
    print("Übernommen: " + ", ".join(f"{t}: {n}" for t, n in accepted.items()))


if __name__ == "__main__":
    main()
