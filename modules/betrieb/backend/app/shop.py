"""Anbindung an den Shop (pi-pos, shop.riedackerhof.ch): bestätigte Anfragen werden Arbeiten, erledigte Arbeiten
erzeugen dort Bestellung und Lieferschein.

- Der Shop bietet Produkte «nur auf Anfrage» an (z.B. Brennholz). Das Büro bestätigt im Backoffice mit Datum «bis».
- Dieser Server fragt alle paar Minuten die Anfragen ab (kein Webhook). Bestätigte Anfragen mit einem hier
  angekreuzten Produkt werden eine Arbeit (work_tasks, source 'shop', source_ref = Anfrage-id) mit «bis spätestens».
- «Erledigt» in der App ruft POST /shop/requests/{id}/delivery-note: der Shop legt Bestellung und Lieferschein an
  (auf den gewählten Kunden, sonst den Sammelkunden) und setzt die Anfrage auf erledigt.

Erreichbarkeit: Das Backoffice steht hinter dem Portal; FMIS spricht den Behälter im gemeinsamen Docker-Netz direkt
an und setzt die Host-Kopfzeile. Adresse, Host und Zugangsschlüssel sind Einstellungen der Instanz (Tabelle
shop_link, nur Server), nie im Repo; der Schlüssel wird nie wieder ausgegeben.

Personendaten: Name, Telefon und Adresse stehen an der offenen Arbeit (man braucht sie beim Liefern, auch ohne
Empfang). Ist die Anfrage erledigt oder abgelehnt, bleibt nur der Verweis «Anfrage CODE» (der Shop löscht die Angaben
nach 90 Tagen).
"""

import asyncio
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
import uuid as uuidlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from .duty_requests import _history

log = logging.getLogger(__name__)
pool = get_pool("betrieb")
router = APIRouter()

ADMIN = "core:modules:manage"
WORK_WRITE = "betrieb:tracking:write"
WORK_READ = "betrieb:tracking:read"
TIMEOUT_S = 20
_lock = asyncio.Lock()


class ShopError(Exception):
    def __init__(self, status: int, text: str) -> None:
        super().__init__(text)
        self.status = status


# --- Aufruf ------------------------------------------------------------------------

def _call(cfg: dict[str, Any], method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, str] | None = None) -> Any:
    url = f"{cfg['base_url'].rstrip('/')}/api/v1{path}"
    if query:
        url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v})
    headers = {"Authorization": f"Bearer {cfg['token']}", "Accept": "application/json"}
    if cfg.get("host"):
        headers["Host"] = cfg["host"]
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = str(json.loads(e.read()).get("detail") or "")
        except Exception:
            pass
        text = {401: "Zugangsschlüssel ungültig oder abgelaufen", 403: "Shop lehnt ab (Host oder Rechte des Schlüssels)", 404: "im Shop nicht gefunden"}.get(e.code, f"Shop meldet {e.code}")
        raise ShopError(e.code, f"{text}{f': {detail}' if detail else ''}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ShopError(0, f"Shop nicht erreichbar ({getattr(e, 'reason', e)})") from None


async def _config(conn: Any) -> dict[str, Any] | None:
    row = await (await conn.execute("select base_url, host, token, variants, poll_minutes from shop_link where id")).fetchone()
    if not row or not row[0] or not row[2]:
        return None
    try:
        variants = json.loads(row[3] or "[]")
    except Exception:
        variants = []
    return {"base_url": row[0], "host": row[1], "token": row[2], "variants": set(map(str, variants)), "poll_minutes": row[4] or 10}


# --- Anfrage → Arbeit ----------------------------------------------------------------

def ref_line(req: dict[str, Any]) -> str:
    """Erste Zeile der Notiz: der dauerhafte Verweis (ohne Personendaten)."""
    kind = "Abholung" if req.get("fulfillment") == "abholung" else "Lieferung"
    return f"Anfrage {req.get('public_code') or str(req.get('id'))[:8]} · {kind}"


def task_fields(req: dict[str, Any], variants: set[str]) -> dict[str, Any] | None:
    """Arbeit aus einer bestätigten Anfrage; None, wenn kein angekreuztes Produkt dabei ist."""
    lines = [ln for ln in req.get("lines") or [] if str(ln.get("variant_id")) in variants]
    if not lines:
        return None
    labels = [str(ln.get("label") or "Produkt") for ln in lines]
    wood = any("holz" in lb.lower() for lb in labels)
    verb = "Bereitstellen" if req.get("fulfillment") == "abholung" else "Liefern"
    single = lines[0] if len(lines) == 1 else None
    quantity = None
    if single is not None:
        try:
            quantity = float(str(single.get("quantity")))
        except (TypeError, ValueError):
            quantity = None
    notes = [ref_line(req)]
    if not single:
        notes += [f"{str(ln.get('quantity') or '').rstrip('0').rstrip('.')} {ln.get('unit') or ''} {ln.get('label') or ''}".strip() for ln in lines]
    for key, label in (("phone", "Tel."), ("address", "Adresse:"), ("customer_note", "Kundschaft:"), ("office_note", "Büro:")):
        if req.get(key):
            notes.append(f"{label} {str(req[key]).strip()}")
    return {
        "title": f"{verb}: {labels[0] if single else ', '.join(labels)}"[:200],
        "area": "brennholz" if wood else "frei",
        "planned_date": req.get("due_date"),
        "due_date": req.get("due_date"),
        "quantity": quantity,
        "unit": (single or {}).get("unit"),
        "customer": req.get("name") or None,
        "notes": "\n".join(notes),
    }


async def _scrub(conn: Any, task_id: Any, req: dict[str, Any], status: str | None = None, done_on: str | None = None) -> None:
    """Personendaten von der Arbeit nehmen (bleibt der Verweis); optional Status setzen."""
    sets = ["customer = %s", "notes = %s", "updated_at = clock_timestamp()"]
    args: list[Any] = [ref_line(req).split(" · ")[0], ref_line(req)]
    if status:
        sets += ["status = %s"]
        args.append(status)
        if status == "erledigt":
            sets += ["done_date = coalesce(done_date, %s::date)", "done_by = coalesce(done_by, 'Shop')"]
            args.append(done_on)
    args.append(task_id)
    await conn.execute(f"update work_tasks set {', '.join(sets)} where id = %s", args)
    await _history(conn, "work_tasks", task_id, "shop")


async def poll() -> dict[str, Any]:
    """Anfragen abholen und Arbeiten anlegen/nachführen. Gibt eine kurze Bilanz zurück."""
    async with _lock:
        async with pool.connection() as conn:
            cfg = await _config(conn)
            if not cfg:
                return {"configured": False}
            try:
                reqs = await asyncio.to_thread(_call, cfg, "GET", "/requests", None, {"status": "bestaetigt,erledigt,abgelehnt,neu", "limit": "500"})
            except ShopError as e:
                await conn.execute("update shop_link set last_poll_at = now(), last_error = %s where id", (str(e),))
                await conn.commit()
                raise
            known = {r[0]: (r[1], r[2]) for r in await (await conn.execute("select request_id, task_id, status from shop_requests")).fetchall()}
            created = updated = closed = 0
            for req in reqs or []:
                rid, status = str(req.get("id")), req.get("status")
                if rid not in known:
                    if status != "bestaetigt":
                        continue
                    f = task_fields(req, cfg["variants"])
                    if not f:
                        continue
                    tid = str(uuidlib.uuid4())
                    await conn.execute(
                        "insert into work_tasks (id, title, area, targets, planned_date, due_date, quantity, unit, notes, source, source_ref, customer, status, created_by, updated_at) "
                        "values (%s, %s, %s, '[]', %s, %s, %s, %s, %s, 'shop', %s, %s, 'offen', 'Shop', clock_timestamp())",
                        (tid, f["title"], f["area"], f["planned_date"], f["due_date"], f["quantity"], f["unit"], f["notes"], rid, f["customer"]),
                    )
                    await _history(conn, "work_tasks", tid, "shop")
                    await conn.execute(
                        "insert into shop_requests (request_id, task_id, public_code, status) values (%s, %s, %s, %s)", (rid, tid, req.get("public_code"), status)
                    )
                    created += 1
                    continue
                tid, old = known[rid]
                task = await (await conn.execute("select status, due_date::text from work_tasks where id = %s and deleted_at is null", (tid,))).fetchone()
                if status != old:
                    await conn.execute(
                        "update shop_requests set status = %s, delivery_note_no = coalesce(%s, delivery_note_no), updated_at = now() where request_id = %s",
                        (status, req.get("delivery_note_no"), rid),
                    )
                if not task or task[0] != "offen":
                    continue
                if status == "erledigt":
                    await _scrub(conn, tid, req, "erledigt", req.get("done_on"))
                    closed += 1
                elif status in ("abgelehnt", "neu"):
                    await _scrub(conn, tid, req, "abgesagt")
                    closed += 1
                elif status == "bestaetigt":
                    f = task_fields(req, cfg["variants"])
                    # Termin oder Angaben im Büro geändert: offene Arbeit nachführen
                    if f and (f["due_date"] != task[1]):
                        await conn.execute(
                            "update work_tasks set planned_date = %s, due_date = %s, quantity = %s, notes = %s, customer = %s, updated_at = clock_timestamp() where id = %s",
                            (f["planned_date"], f["due_date"], f["quantity"], f["notes"], f["customer"], tid),
                        )
                        await _history(conn, "work_tasks", tid, "shop")
                        updated += 1
            await conn.execute("update shop_link set last_poll_at = now(), last_ok_at = now(), last_error = null where id")
            await conn.commit()
            return {"configured": True, "created": created, "updated": updated, "closed": closed}


async def periodic() -> None:
    """Hintergrund: alle poll_minutes abfragen (nur wenn eingerichtet)."""
    await asyncio.sleep(45)
    while True:
        minutes = 10
        try:
            async with pool.connection() as conn:
                cfg = await _config(conn)
            if cfg:
                minutes = max(2, int(cfg["poll_minutes"]))
                r = await poll()
                if r.get("created") or r.get("closed"):
                    log.info("Shop: %s neue Arbeiten, %s abgeschlossen", r.get("created"), r.get("closed"))
        except ShopError as e:
            log.warning("Shop-Abfrage: %s", e)
        except Exception:
            log.exception("Shop-Abfrage")
        await asyncio.sleep(minutes * 60)


# --- Endpunkte -----------------------------------------------------------------------

def _need(user: CurrentUser, perm: str) -> None:
    if perm not in user.permissions:
        raise HTTPException(status_code=403, detail="Keine Berechtigung")


async def _cfg_or_409() -> dict[str, Any]:
    async with pool.connection() as conn:
        cfg = await _config(conn)
    if not cfg:
        raise HTTPException(status_code=409, detail="Shop-Anbindung ist nicht eingerichtet")
    return cfg


async def _shop(cfg: dict[str, Any], method: str, path: str, body: dict[str, Any] | None = None, query: dict[str, str] | None = None) -> Any:
    try:
        return await asyncio.to_thread(_call, cfg, method, path, body, query)
    except ShopError as e:
        raise HTTPException(status_code=409 if e.status == 409 else 502, detail=str(e)) from None


class Settings(BaseModel):
    base_url: str = ""
    host: str = ""
    # leer = bisherigen Schlüssel behalten
    token: str = ""
    variants: list[str] = []
    poll_minutes: int = 10


@router.get("/shop/settings")
async def get_settings(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    _need(user, ADMIN)
    async with pool.connection() as conn:
        row = await (
            await conn.execute("select base_url, host, token is not null and token <> '', variants, poll_minutes, last_poll_at, last_ok_at, last_error from shop_link where id")
        ).fetchone()
    if not row:
        return {"base_url": "", "host": "", "has_token": False, "variants": [], "poll_minutes": 10, "last_poll_at": None, "last_ok_at": None, "last_error": None}
    return {
        "base_url": row[0] or "", "host": row[1] or "", "has_token": bool(row[2]), "variants": json.loads(row[3] or "[]"), "poll_minutes": row[4],
        "last_poll_at": row[5].isoformat() if row[5] else None, "last_ok_at": row[6].isoformat() if row[6] else None, "last_error": row[7],
    }


@router.put("/shop/settings")
async def put_settings(body: Settings, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    _need(user, ADMIN)
    base = body.base_url.strip()
    if base and not base.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="Adresse muss mit http:// oder https:// beginnen")
    async with pool.connection() as conn:
        await conn.execute(
            "insert into shop_link (id, base_url, host, token, variants, poll_minutes, updated_by, updated_at) values (true, %s, %s, nullif(%s, ''), %s, %s, %s, now()) "
            "on conflict (id) do update set base_url = excluded.base_url, host = excluded.host, token = coalesce(excluded.token, shop_link.token), "
            "variants = excluded.variants, poll_minutes = excluded.poll_minutes, updated_by = excluded.updated_by, updated_at = now(), last_error = null",
            (base or None, body.host.strip() or None, body.token.strip(), json.dumps(sorted(set(body.variants))), max(2, min(body.poll_minutes, 1440)), user.email),
        )
        await conn.commit()
    return await get_settings(user)


@router.delete("/shop/settings/token", status_code=204)
async def delete_token(user: CurrentUser = Depends(require_auth)) -> None:
    _need(user, ADMIN)
    async with pool.connection() as conn:
        await conn.execute("update shop_link set token = null, updated_by = %s, updated_at = now() where id", (user.email,))
        await conn.commit()


@router.get("/shop/catalog")
async def catalog(user: CurrentUser = Depends(require_auth)) -> Any:
    _need(user, ADMIN)
    return await _shop(await _cfg_or_409(), "GET", "/requests/catalog")


@router.get("/shop/customers")
async def customers(q: str = "", user: CurrentUser = Depends(require_auth)) -> Any:
    _need(user, WORK_WRITE)
    return await _shop(await _cfg_or_409(), "GET", "/requests/customers", None, {"q": q})


@router.post("/shop/poll")
async def poll_now(user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    _need(user, WORK_WRITE)
    try:
        return await poll()
    except ShopError as e:
        raise HTTPException(status_code=502, detail=str(e)) from None


class DeliveryNote(BaseModel):
    customer_id: str | None = None
    quantity: float | None = None
    delivered_on: str | None = None
    note: str | None = None


@router.post("/shop/tasks/{task_id}/delivery-note")
async def delivery_note(task_id: str, body: DeliveryNote, user: CurrentUser = Depends(require_auth)) -> dict[str, Any]:
    """Lieferschein im Shop für die Anfrage hinter dieser Arbeit; setzt die Anfrage dort auf erledigt."""
    _need(user, WORK_WRITE)
    cfg = await _cfg_or_409()
    async with pool.connection() as conn:
        row = await (await conn.execute("select request_id from shop_requests where task_id = %s", (task_id,))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Diese Arbeit stammt nicht aus einer Shop-Anfrage")
    rid = row[0]
    payload: dict[str, Any] = {"customer_id": body.customer_id, "delivered_on": body.delivered_on, "note": body.note}
    if body.quantity is not None:
        # Menge geändert: nur bei einer einzelnen Zeile eindeutig
        req = await _shop(cfg, "GET", f"/requests/{rid}")
        lines = [ln for ln in (req or {}).get("lines") or [] if str(ln.get("variant_id")) in cfg["variants"]] or (req or {}).get("lines") or []
        if len(lines) == 1:
            payload["lines"] = [{"variant_id": lines[0]["variant_id"], "quantity": str(body.quantity)}]
    done = await _shop(cfg, "POST", f"/requests/{rid}/delivery-note", {k: v for k, v in payload.items() if v is not None})
    no = (done or {}).get("delivery_note_no")
    async with pool.connection() as conn:
        await conn.execute("update shop_requests set status = 'erledigt', delivery_note_no = %s, updated_at = now() where request_id = %s", (no, rid))
        await conn.commit()
    return {"delivery_note_no": no, "public_code": (done or {}).get("public_code")}
