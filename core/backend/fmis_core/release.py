"""Testumgebung (dev-fmis) und Freigabe für Prod.

Die Testumgebung folgt `main` und holt vor jedem Update den Datenstand von Prod
(tools/deploy/fmis-deploy.sh, Befehl `dev`). Prod bekommt nur, was ein Admin hier
freigibt: Der Knopf legt eine Anfrage in den Briefkasten-Ordner (FREIGABE_DIR, vom
Host eingebunden), der Host holt sie im Minutentakt ab (Befehl `freigabe`) und
spielt genau diesen Commit auf Prod ein. Die Instanz selbst braucht dafür weder
Zugang zu Prod noch zu Docker oder Git.

Dateien im Briefkasten (schreibt das Skript auf dem Host, ausser angefordert.json):
  stand.json        Commit auf dev und Prod, Commits dazwischen, Zeit des Datenstands
  datenstand.txt    Kennung des Datenstands: ändert sie, verwerfen die Geräte ihre lokale Kopie
  angefordert.json  Freigabe-Anfrage (Commit, wer, wann), schreibt dieser Knopf
  freigabe.json     Ergebnis der letzten Freigabe
"""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import CurrentUser, require_permission

router = APIRouter()
INSTANZ = os.environ.get("FMIS_INSTANZ", "").strip() or None
BOX = Path(os.environ.get("FREIGABE_DIR", "/freigabe"))
ADMIN = "core:users:manage"


def _read_json(name: str) -> dict[str, Any] | None:
    try:
        data = json.loads((BOX / name).read_text())
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def datenstand() -> str | None:
    if not INSTANZ:
        return None
    try:
        return (BOX / "datenstand.txt").read_text().strip() or None
    except OSError:
        return None


@router.get("/core/instance")
async def instance() -> dict[str, Any]:
    """Ohne Anmeldung: welche Instanz, welcher Datenstand. Prod: beides leer."""
    return {"instanz": INSTANZ, "datenstand": datenstand()}


@router.get("/admin/release")
async def release_status(user: CurrentUser = Depends(require_permission(ADMIN))) -> dict[str, Any]:
    if INSTANZ != "dev":
        raise HTTPException(status_code=404, detail="Freigaben gibt es nur in der Testumgebung")
    return {"stand": _read_json("stand.json"), "angefordert": _read_json("angefordert.json"), "letzte": _read_json("freigabe.json")}


class ReleaseBody(BaseModel):
    sha: str


@router.post("/admin/release")
async def request_release(body: ReleaseBody, user: CurrentUser = Depends(require_permission(ADMIN))) -> dict[str, Any]:
    if INSTANZ != "dev":
        raise HTTPException(status_code=404, detail="Freigaben gibt es nur in der Testumgebung")
    stand = _read_json("stand.json") or {}
    if not re.fullmatch(r"[0-9a-f]{40}", body.sha) or body.sha != stand.get("dev_sha"):
        # nur genau der Stand, der hier läuft und geprüft wurde
        raise HTTPException(status_code=409, detail="Die Testumgebung läuft inzwischen auf einem anderen Stand. Seite neu laden.")
    if body.sha == stand.get("prod_sha"):
        raise HTTPException(status_code=409, detail="Dieser Stand läuft schon auf Prod.")
    request = {"sha": body.sha, "von": user.email, "am": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    tmp = BOX / ".angefordert.tmp"
    try:
        tmp.write_text(json.dumps(request))
        tmp.replace(BOX / "angefordert.json")
    except OSError as e:
        raise HTTPException(status_code=503, detail="Briefkasten für Freigaben nicht beschreibbar") from e
    return request
