"""Proviande-Wochenpreise automatisch holen (Schafe/Lämmer und Rindvieh).

Proviande veröffentlicht die QM-Wochenpreise jeden Donnerstag als PDF unter festen
Adressen. Der Server liest sie alle paar Stunden (und auf Knopfdruck) mit pdftotext,
nimmt je Kategorie und Fleischigkeit den Preis (Fettklasse 3, ohne Abzug) und legt
eine neue Woche in proviande_prices ab. Für den Mastplaner kommt zudem eine Zeile in
market_prices (LA T3, SM T3; Gebühren und Bio-Zuschlag wie bisher).

Importe ergänzen nur: Eine Woche, die schon da ist, wird nie überschrieben, und es
wird nie gelöscht. Wer einen Preis anders will, erfasst ihn in der App neu.
"""

import asyncio
import json
import logging
import re
import subprocess
import tempfile
import urllib.request
import uuid as uuidlib
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool

log = logging.getLogger(__name__)
pool = get_pool("livestock")
router = APIRouter()

BASE = "https://www.proviande.ch/sites/proviande/files/2020-02"
SOURCES = {
    "schafe": f"{BASE}/Wochenpreise_Schafe_Laemmer.pdf",
    "rindvieh": f"{BASE}/Wochenpreise_Rindvieh.pdf",
}
INTERVAL_S = 6 * 3600
WRITE = "livestock:slaughter:write"
_lock = asyncio.Lock()

# Spalten je Tabelle (Zahlen einer Fleischigkeitszeile von links): (Kategorie, sg|lg) oder None (A%).
# Eine Zeile zählt nur mit genau so vielen Zahlen — sonst fehlen Felder (z.B. RG ab A), und
# die Zuordnung wäre falsch.
SHEEP = [("LA", "sg"), None, ("LA", "lg"), ("SM", "sg"), None, ("SM", "lg"), ("WP", "lg")]
CATTLE_1 = [("MT", "sg"), None, ("MT", "lg"), ("OB", "sg"), None, ("OB", "lg"), ("RG", "sg"), None, ("RG", "lg"), ("KV", "sg")]
CATTLE_2 = [("VK", "sg"), None, ("VK", "lg"), ("MA", "sg"), None, ("MA", "lg"), ("JB", "lg")]

_NUM = re.compile(r"^-?\d+(\.\d+)?$")
_ROW = re.compile(r"^\s*([CHTAX+\-])\s+(.*)$")


def _rows(page: str, columns: list[tuple[str, str] | None]) -> dict[tuple[str, str], dict[str, Decimal]]:
    out: dict[tuple[str, str], dict[str, Decimal]] = {}
    for line in page.splitlines():
        m = _ROW.match(line)
        if not m:
            continue
        nums: list[str] = []
        for tok in m.group(2).split():
            if not _NUM.match(tok):
                break
            nums.append(tok)
        if len(nums) != len(columns):
            continue
        for col, val in zip(columns, nums):
            if col:
                out.setdefault((col[0], m.group(1)), {})[col[1]] = Decimal(val)
    return out


def parse(text: str) -> dict[str, Any]:
    """Text von `pdftotext -layout` → Woche, gültig ab, Preise je (Kategorie, Fleischigkeit)."""
    week = re.search(r"^\s*(\d{1,2}/\d{4})", text, re.M)
    valid = re.search(r"(?:Gültig ab|Valables dès):?\s*(\d{2})\.(\d{2})\.(\d{4})", text) or re.search(r"(\d{2})\.(\d{2})\.(\d{4})", text)
    if not week or not valid:
        raise ValueError("Woche oder Gültigkeitsdatum nicht gefunden")
    prices: dict[tuple[str, str], dict[str, Decimal]] = {}
    for page in text.split("\f"):
        if "SCHLACHTLÄMMER" in page:
            prices.update(_rows(page, SHEEP))
        elif "KÄLBER" in page and "MUNI (241" in page:
            prices.update(_rows(page, CATTLE_1))
        elif "KÜHE über 240 Tage" in page:
            prices.update(_rows(page, CATTLE_2))
    if not prices:
        raise ValueError("keine Preiszeilen gefunden")
    d, m, y = valid.groups()
    return {"week": week.group(1), "valid_from": date(int(y), int(m), int(d)), "prices": prices}


def _fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "FMIS Riedackerhof (Wochenpreise)"})
    with urllib.request.urlopen(req, timeout=30) as resp, tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(resp.read())
        f.flush()
        return subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True, check=True, timeout=60).stdout


async def _history(conn: Any, table: str, row_id: str, by: str) -> None:
    snap = await (await conn.execute(f'select row_to_json(t)::text from "{table}" t where id = %s', (row_id,))).fetchone()
    await conn.execute(
        "insert into data_history (id, table_name, row_id, action, changed_by, changed_at, snapshot, updated_at) "
        "values (%s, %s, %s, 'insert', %s, clock_timestamp(), %s, clock_timestamp())",
        (str(uuidlib.uuid4()), table, row_id, by, snap[0] if snap else json.dumps({})),
    )


async def store(parsed: dict[str, Any], url: str, by: str) -> dict[str, Any]:
    """Neue Woche ablegen; bestehende bleiben unverändert. Gibt zurück, was neu ist."""
    source = f"Proviande Woche {parsed['week']} (automatisch)"
    added = 0
    market = False
    async with pool.connection() as conn, conn.transaction():
        for (cat, flesh), p in parsed["prices"].items():
            row = await (
                await conn.execute(
                    "insert into proviande_prices (id, valid_from, week, category, fleshiness, price_sg, price_lg, source, updated_at) "
                    "values (%s, %s, %s, %s, %s, %s, %s, %s, clock_timestamp()) on conflict (valid_from, category, fleshiness) do nothing returning id",
                    (str(uuidlib.uuid4()), parsed["valid_from"], parsed["week"], cat, flesh, p.get("sg"), p.get("lg"), url),
                )
            ).fetchone()
            if row:
                added += 1
        la, sm = parsed["prices"].get(("LA", "T"), {}).get("sg"), parsed["prices"].get(("SM", "T"), {}).get("sg")
        exists = await (await conn.execute("select 1 from market_prices where valid_from = %s and deleted_at is null", (parsed["valid_from"],))).fetchone()
        if la is not None and sm is not None and not exists:
            prev = await (
                await conn.execute("select bio_premium, fee_per_animal from market_prices where deleted_at is null order by valid_from desc, updated_at desc limit 1")
            ).fetchone()
            mid = str(uuidlib.uuid4())
            await conn.execute(
                "insert into market_prices (id, valid_from, la_t3, sm_t3, bio_premium, fee_per_animal, source, updated_at) "
                "values (%s, %s, %s, %s, coalesce(%s, 0), coalesce(%s, 3.72), %s, clock_timestamp())",
                (mid, parsed["valid_from"], la, sm, prev[0] if prev else None, prev[1] if prev else None, source),
            )
            await _history(conn, "market_prices", mid, by)
            market = True
    return {"week": parsed["week"], "valid_from": parsed["valid_from"].isoformat(), "added": added, "market_prices": market}


async def refresh(by: str) -> list[dict[str, Any]]:
    async with _lock:
        out = []
        for name, url in SOURCES.items():
            try:
                text = await asyncio.to_thread(_fetch_text, url)
                out.append({"source": name, **await store(parse(text), url, by)})
            except Exception as e:  # eine Quelle kaputt: die andere trotzdem
                log.exception("Proviande %s fehlgeschlagen", name)
                out.append({"source": name, "error": str(e)})
        return out


async def periodic() -> None:
    """Hintergrund (backend/app/main.py): kurz nach dem Start, dann alle paar Stunden."""
    await asyncio.sleep(60)
    while True:
        try:
            for r in await refresh("Proviande (automatisch)"):
                if r.get("added") or r.get("error"):
                    log.info("Proviande: %s", r)
        except Exception:
            log.exception("Proviande-Abruf fehlgeschlagen")
        await asyncio.sleep(INTERVAL_S)


@router.post("/proviande/refresh")
async def refresh_now(user: CurrentUser = Depends(require_auth)) -> list[dict[str, Any]]:
    if WRITE not in user.permissions:
        raise HTTPException(status_code=403, detail="Preise abrufen braucht das Recht Schlachtung/Vermarktung")
    return await refresh(f"{user.email} (Proviande)")
