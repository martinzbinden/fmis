from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from .tables import SYNC_TABLES, table_area


class PushRequest(BaseModel):
    tables: dict[str, list[dict[str, Any]]]


class PushResponse(BaseModel):
    accepted: dict[str, int]


class PullResponse(BaseModel):
    server_time: str
    tables: dict[str, list[dict[str, Any]]]


def build_router(key: str) -> APIRouter:
    """Baut einen frischen Sync-Router für EINE Instanz dieses Moduls.

    Dieses Modul kann mehrfach instanziert werden (siehe module_registry.py,
    ModuleSpec.source) — z.B. "dairy" für Kühe und "dairy_schafe" für Schafe,
    beide mit demselben Code, aber je eigenem Postgres-Schema (`key`), eigener
    Pool-Verbindung und eigenem Rechte-Prefix. Deshalb dürfen `pool`/`area`
    keine Modul-level Singletons sein, sondern werden pro Instanz gebaut.
    """
    # Eigener Pool mit search_path='<key>,public' (siehe fmis_core/db.py) —
    # die untenstehenden Queries bleiben dadurch unqualifiziert (z.B.
    # `select ... from "animals"`) und landen trotzdem im richtigen Postgres-
    # Schema, ohne Änderung an einer einzigen SQL-Zeile.
    pool = get_pool(key)
    area = table_area(key)

    router = APIRouter()

    @router.post("/sync/push", response_model=PushResponse)
    async def push(body: PushRequest, user: CurrentUser = Depends(require_auth)) -> PushResponse:
        # All-or-nothing: fehlt für irgendeine der enthaltenen Tabellen das
        # Schreibrecht, wird der GESAMTE Request abgelehnt. Die UI sollte
        # ohnehin nie einen Request ohne die nötigen Rechte schicken (siehe
        # AuthContext).
        for table in body.tables:
            if table == "data_history":
                # Entsteht immer als Nebeneffekt einer im selben Request
                # bereits geprüften Schreibung auf einer anderen Tabelle
                # (siehe frontend/src/db/write.ts: recordHistory()) — kein
                # eigenes Schreibrecht nötig. Sonst müsste jede Rolle mit
                # irgendeinem Schreibrecht zusätzlich explizit history:write
                # bekommen, sonst würde JEDER Push (nicht nur die
                # History-Zeile) abgelehnt.
                continue
            table_area_name = area.get(table)
            if table_area_name is None or f"{table_area_name}:write" not in user.permissions:
                raise HTTPException(status_code=403, detail=f"Keine Schreibrechte für {table}")

        accepted: dict[str, int] = {}
        async with pool.connection() as conn:
            for table, rows in body.tables.items():
                columns = SYNC_TABLES.get(table)
                if columns is None or not rows:
                    continue
                set_clause = ", ".join(f'"{c}" = excluded."{c}"' for c in columns if c != "id")
                col_list = ", ".join(f'"{c}"' for c in columns)
                placeholders = ", ".join(f"%({c})s" for c in columns)
                sql = (
                    f'insert into "{table}" ({col_list}) values ({placeholders}) '
                    f'on conflict (id) do update set {set_clause} '
                    f'where "{table}".updated_at < excluded.updated_at'
                )
                count = 0
                async with conn.cursor() as cur:
                    for row in rows:
                        params = {c: row.get(c) for c in columns}
                        await cur.execute(sql, params)
                        count += 1
                accepted[table] = count
            await conn.commit()
        return PushResponse(accepted=accepted)

    @router.get("/sync/pull", response_model=PullResponse)
    async def pull(since: str | None = None, user: CurrentUser = Depends(require_auth)) -> PullResponse:
        tables: dict[str, list[dict[str, Any]]] = {}
        async with pool.connection() as conn:
            server_time_row = await (await conn.execute("select now()")).fetchone()
            server_time = server_time_row[0].isoformat()
            for table, columns in SYNC_TABLES.items():
                table_area_name = area.get(table)
                if table_area_name is None or f"{table_area_name}:read" not in user.permissions:
                    # Tabelle wird komplett weggelassen statt leer
                    # zurückgegeben — Daten ohne Leserecht landen so nie
                    # lokal in pglite.
                    continue
                col_list = ", ".join(f'"{c}"' for c in columns)
                if since:
                    sql = f'select {col_list} from "{table}" where updated_at > %s'
                    rows = await (await conn.execute(sql, (since,))).fetchall()
                else:
                    sql = f'select {col_list} from "{table}"'
                    rows = await (await conn.execute(sql)).fetchall()
                tables[table] = [
                    {col: _jsonable(val) for col, val in zip(columns, row)} for row in rows
                ]
        return PullResponse(server_time=server_time, tables=tables)

    return router


def _jsonable(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
