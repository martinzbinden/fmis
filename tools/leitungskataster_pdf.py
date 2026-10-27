#!/usr/bin/env python3
"""Leitungskataster-Auszug (PDF aus dem Geoportal des Kantons Bern) → Grundlage für Bauprojekte.

Der Auszug enthält je Ebene (Abwasser, Wasser, Elektro, …) ein transparentes Rasterbild
(PDF-Ebenen / OCG) und als eigene Ebene «Koordinaten» das Kreuznetz im Abstand von 100 m.
Das Werkzeug liest die Bilder und die Kreuze, passt die Ebenen in LV95 ein, rechnet sie in
die Kartenprojektion (EPSG:3857) um und schreibt ein ZIP mit manifest.json und je Ebene
einem PNG. Das ZIP wird in FMIS unter Bauprojekte → Karte → 🗂️ → «Grundlage hinzufügen»
hochgeladen (modules/bau/backend/app/overlays.py). Leere Ebenen werden weggelassen.

Die Kreuze tragen keine maschinenlesbare Beschriftung: die Koordinate des Kreuzes unten
links liest man im PDF ab (Randbeschriftung) und gibt sie mit --kreuz an.

Braucht: mutool, pdfimages (poppler), gdal_translate/gdalwarp, Python mit Pillow und numpy.

    python3 tools/leitungskataster_pdf.py "LKB BE Riedacker.pdf" --kreuz 2596900,1181800 \
        --gruppe "Leitungskataster Rüschegg (Auszug 06.11.2024)" -o lkb_riedacker.zip
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
GRID_M = 100.0  # Abstand der Kreuze

# Ebenenname im PDF → Name in FMIS, Standard sichtbar
LAYERS = {
    "LKBE Abwasser": ("Abwasser", True),
    "LKBE Wasser": ("Wasser", True),
    "LKBE Gas": ("Gas", True),
    "LKBE Fernwärme": ("Fernwärme", True),
    "LKBE Elektro": ("Elektro", True),
    "LKBE Kommunikation": ("Kommunikation", True),
    "AV / Ortsplan (Graustufen)": ("AV-Plan (Auszug)", False),
    "AV ausserhalb Bern": ("AV ausserhalb Bern", False),
    "Projektgebiet": ("Projektgebiet", True),
    "Gemeindegrenzen": ("Gemeindegrenzen", False),
}


def sh(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True, errors="replace").stdout


def obj(pdf: str, num: int | str, raw: bool = False) -> str:
    return sh("mutool", "show", *(["-b"] if raw else []), pdf, str(num))


def first_page(pdf: str) -> tuple[str, str]:
    """(Objektnummer der Ressourcen, des Inhalts) der ersten Seite."""
    kids = re.search(r"/Kids \[ ?(\d+) 0 R", obj(pdf, "trailer/Root/Pages"))
    root = obj(pdf, kids.group(1)) if kids else ""
    res, content = re.search(r"/Resources (\d+) 0 R", root), re.search(r"/Contents (\d+) 0 R", root)
    if not res or not content:
        sys.exit("Seite 1 hat keine einzelnen Ressourcen/Inhalt (anderer PDF-Aufbau).")
    return res.group(1), content.group(1)


def ocg_names(pdf: str) -> dict[str, str]:
    """ZI-Kürzel im Seiteninhalt → Ebenenname."""
    res = obj(pdf, first_page(pdf)[0])
    out = {}
    for tag, num in re.findall(r"/(ZI\d+) (\d+) 0 R", res):
        o = obj(pdf, num)
        h = re.search(r"/Name <FEFF([0-9A-F]+)>", o)
        n = re.search(r"/Name \(([^)]*)\)", o)
        out[tag] = bytes.fromhex(h.group(1)).decode("utf-16-be") if h else (n.group(1) if n else tag)
    return out


def page_layers(pdf: str) -> tuple[list[tuple[str, str, tuple[float, ...]]], tuple[str, tuple[float, ...]] | None, dict[str, str]]:
    """[(Ebene, Bildname, cm-Matrix)], (Formname, cm) des Kreuznetzes, Bildname → Objektnummer."""
    names = ocg_names(pdf)
    res_num, content_num = first_page(pdf)
    content = obj(pdf, content_num, raw=True)
    res = obj(pdf, res_num)
    xobj = dict(re.findall(r"/(I\d+|TPL\d+|FO\d+) (\d+) 0 R", res))
    images, grid = [], None
    for tag, body in re.findall(r"/OC /(ZI\d+) BDC(.*?)EMC", content, re.S):
        m = re.search(r"([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*/(\w+) Do", body)
        if not m:
            continue
        cm = tuple(float(x) for x in m.groups()[:4])
        if tag not in names:  # z.B. Wappen im Kopf, keine Kartenebene
            continue
        if names[tag] == "Koordinaten":
            grid = (m.group(5), cm)
        elif m.group(5).startswith("I"):
            images.append((names.get(tag, tag), m.group(5), cm))
    return images, grid, xobj


def grid_crosses(pdf: str, form_num: str) -> tuple[list[float], list[float]]:
    """x- und y-Werte der Kreuzmittelpunkte (Kreise mit Radius 3) im Formular-Koordinatensystem."""
    inner = re.search(r"/Xf\d+ (\d+) 0 R", obj(pdf, form_num))
    s = obj(pdf, inner.group(1) if inner else form_num, raw=True)
    pts = {(round(float(x) - 3, 2), round(float(y), 2)) for x, y in re.findall(r"([\d.]+) ([\d.]+) m\n\1 [\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+ c", s)}
    return sorted({p[0] for p in pts}), sorted({p[1] for p in pts})


def white_to_alpha(rgb: np.ndarray, alpha: np.ndarray) -> Image.Image:
    """Die Linien sind gegen Weiss geglättet: Weissanteil in Transparenz umrechnen («Farbe zu Alpha»),
    sonst haben sie auf dem Luftbild helle Säume."""
    c = rgb.astype(np.float32)
    t = 1 - c.min(axis=2) / 255  # Deckung ohne Weiss
    safe = np.maximum(t, 1e-3)[..., None]
    pure = np.clip(255 - (255 - c) / safe, 0, 255)
    a = np.clip(alpha.astype(np.float32) * t, 0, 255)
    return Image.fromarray(np.dstack([pure, a]).astype(np.uint8), "RGBA")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("--kreuz", required=True, help="LV95-Koordinate E,N des Kreuzes unten links")
    ap.add_argument("--gruppe", required=True, help="Name der Grundlage in FMIS")
    ap.add_argument("--quelle", default="Leitungskataster © Amt für Geoinformation des Kantons Bern; Gemeinden des Kantons Bern. Nur informativ.")
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()
    a.pdf, a.out = os.path.abspath(a.pdf), os.path.abspath(a.out)
    e0, n0 = (float(v) for v in a.kreuz.split(","))

    images, grid, xobj = page_layers(a.pdf)
    if not grid:
        sys.exit("Keine Ebene «Koordinaten» mit Kreuznetz gefunden.")
    form_name, gcm = grid
    xs, ys = grid_crosses(a.pdf, xobj[form_name])
    if len(xs) < 2 or len(ys) < 2:
        sys.exit(f"Zu wenige Kreuze gefunden ({xs}, {ys}).")
    step_x = (xs[-1] - xs[0]) / (len(xs) - 1)
    step_y = (ys[-1] - ys[0]) / (len(ys) - 1)
    # Formular → Seite (pt): page = off + scale * f
    fsx, fsy, fox, foy = gcm
    # Seite (pt) → LV95
    m_per_pt_x = GRID_M / (step_x * fsx)
    m_per_pt_y = GRID_M / (step_y * fsy)
    px0, py0 = fox + fsx * xs[0], foy + fsy * ys[0]  # Kreuz unten links in pt
    print(f"{len(xs)}×{len(ys)} Kreuze, {GRID_M / step_x:.5f} / {GRID_M / step_y:.5f} m je Einheit", file=sys.stderr)

    tmp = tempfile.mkdtemp(prefix="lkb_")
    os.chdir(tmp)  # mutool extract schreibt ins Arbeitsverzeichnis
    layers = []
    for name, img_name, (w_pt, h_pt, x_pt, y_pt) in images:
        label, visible = LAYERS.get(name, (name, True))
        num = xobj[img_name]
        meta = obj(a.pdf, num)
        smask = re.search(r"/SMask (\d+) 0 R", meta)
        src = os.path.join(tmp, f"{img_name}")
        sh("mutool", "extract", "-r", a.pdf, num)  # schreibt image-<num>.png ins Arbeitsverzeichnis
        os.replace(f"image-{int(num):04d}.png", src + ".png")
        im = Image.open(src + ".png")
        if smask:
            sh("mutool", "extract", "-r", a.pdf, smask.group(1))
            mk = f"image-{int(smask.group(1)):04d}.png"
            alpha = Image.open(mk).convert("L")
            os.remove(mk)
            rgba = white_to_alpha(np.asarray(im.convert("RGB")), np.asarray(alpha))
        else:
            # deckender Graustufenplan: Weiss durchsichtig, Linien dunkel
            g = np.asarray(im.convert("L"), dtype=np.uint8)
            rgba = Image.fromarray(np.dstack([np.full_like(g, 40)] * 3 + [255 - g]), "RGBA")
        arr = np.asarray(rgba)
        opaque = arr[..., 3] > 40
        if opaque.mean() < 0.0002:
            print(f"  {name}: leer, weggelassen", file=sys.stderr)
            continue
        core = arr[..., 3] > 200
        rgb = arr[..., :3][core if core.sum() > 50 else opaque]
        color = "#%02x%02x%02x" % tuple(int(v) for v in np.median(rgb, axis=0)) if smask else "#555555"
        rgba.save(src + "_rgba.png")
        W, H = rgba.size
        # Bild (links oben) → LV95
        left = e0 + (x_pt - px0) * m_per_pt_x
        top = n0 + (y_pt + h_pt - py0) * m_per_pt_y
        res_x = w_pt / W * m_per_pt_x
        res_y = h_pt / H * m_per_pt_y
        tif = src + ".tif"
        sh("gdal_translate", "-q", "-a_srs", "EPSG:2056", "-a_ullr", f"{left}", f"{top}", f"{left + W * res_x}", f"{top - H * res_y}", src + "_rgba.png", tif)
        merc = src + "_3857.tif"
        sh("gdalwarp", "-q", "-overwrite", "-t_srs", "EPSG:3857", "-r", "bilinear", "-dstalpha", "-co", "COMPRESS=DEFLATE", tif, merc)
        out_png = f"{label.lower().replace(' ', '_').replace('/', '_')}.png"
        sh("gdal_translate", "-q", "-of", "PNG", "-b", "1", "-b", "2", "-b", "3", "-b", "4", merc, os.path.join(tmp, out_png))
        info = json.loads(sh("gdalinfo", "-json", merc))
        wgs = info["wgs84Extent"]["coordinates"][0]
        lons = [c[0] for c in wgs]
        lats = [c[1] for c in wgs]
        layers.append({"file": out_png, "name": label, "pdf_layer": name, "color": color, "visible": visible,
                       "bounds": [min(lats), min(lons), max(lats), max(lons)]})
        print(f"  {name} → {label} {color}", file=sys.stderr)

    manifest = {"fmis_grundlage": 1, "group": a.gruppe, "kind": "leitungskataster", "source": a.quelle, "layers": layers}
    with zipfile.ZipFile(a.out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        for la in layers:
            z.write(os.path.join(tmp, la["file"]), la["file"])
    print(f"{a.out}: {len(layers)} Ebenen", file=sys.stderr)


if __name__ == "__main__":
    main()
