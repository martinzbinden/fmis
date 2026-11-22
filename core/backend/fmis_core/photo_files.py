"""Fotos als Dateien statt in der Datenbank (Arbeiten, Betriebs- und Stalljournal).

Warum Dateien: Die Datenbank-Sicherung (pg_dump bei jeder Freigabe, tools/deploy/fmis-deploy.sh) bleibt klein und
schnell; Fotos sind zweite Priorität. Sie liegen in einem eigenen Volume (PHOTO_DIR, docker-compose.yml
photos_data), nach Modul, Jahr und Monat abgelegt:

    PHOTO_DIR/<modul>/<JJJJ>/<MM>/<id>.webp        Foto (lange Seite höchstens 1600 px)
    PHOTO_DIR/<modul>/<JJJJ>/<MM>/<id>-t.webp      Vorschau (lange Seite 320 px)

So lässt sich das Volume getrennt (oder gar nicht) sichern und ein ganzes altes Jahr archivieren, indem man den
Ordner wegschiebt: GET meldet dann «archiviert» (410), solange die Angaben noch in der Datenbank stehen.

Eine id behält ihren Inhalt für immer: ein zweites PUT ändert nichts (Hochladen ist beliebig wiederholbar).
"""

import os
from datetime import date
from pathlib import Path

PHOTO_DIR = Path(os.environ.get("PHOTO_DIR", "/data/photos"))
MAX_BYTES = 15 * 1024 * 1024
MAX_THUMB_BYTES = 512 * 1024
EXT = {"image/webp": ".webp", "image/jpeg": ".jpg", "image/png": ".png"}
TYPE_OF = {v: k for k, v in EXT.items()}


def _name(photo_id: str, thumb: bool, ext: str) -> str:
    return f"{photo_id}{'-t' if thumb else ''}{ext}"


def find(module: str, photo_id: str, thumb: bool = False) -> tuple[Path, str] | None:
    """Datei eines Fotos (Pfad, Typ) oder None. Sucht in allen Jahres-/Monatsordnern des Moduls."""
    base = PHOTO_DIR / module
    if not base.is_dir():
        return None
    for ext, ctype in TYPE_OF.items():
        hits = list(base.glob(f"*/*/{_name(photo_id, thumb, ext)}"))
        if hits:
            return hits[0], ctype
    return None


def save(module: str, photo_id: str, data: bytes, content_type: str, thumb: bool = False) -> bool:
    """Foto ablegen (Ordner des laufenden Monats). False, wenn es schon da ist."""
    if find(module, photo_id, thumb):
        return False
    today = date.today()
    folder = PHOTO_DIR / module / f"{today.year:04d}" / f"{today.month:02d}"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / _name(photo_id, thumb, EXT[content_type])
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(target)
    return True
