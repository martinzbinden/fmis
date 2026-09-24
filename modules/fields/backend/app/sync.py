from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from .tables import GEOMETRY_COLUMNS, SYNC_TABLES, TABLE_AREA

# Eigener Pool mit search_path='fields,public' (siehe fmis_core/db.py) — die
# untenstehenden Queries bleiben dadurch unqualifiziert (z.B.
# `select ... from "farms"`) und landen trotzdem im richtigen Postgres-
# Schema, ohne Änderung an einer einzigen SQL-Zeile.
pool = get_pool("fields")

router = APIRouter()


class PushRequest(BaseModel):
    tables: dict[str, list[dict[str, Any]]]


class PushResponse(BaseModel):
    accepted: dict[str, int]


class PullResponse(BaseModel):
    server_time: str
    tables: dict[str, list[dict[str, Any]]]
class HistoryResponse(BaseModel):
    entries: list[dict[str, Any]]


@router.post("/sync/push", response_model=PushResponse)
async def push(body: PushRequest, user: CurrentUser = Depends(require_auth)) -> PushResponse:
    # All-or-nothing: fehlt für irgendeine der enthaltenen Tabellen das
    # Schreibrecht, wird der GESAMTE Request abgelehnt. Die UI sollte ohnehin
    # nie einen Request ohne die nötigen Rechte schicken (siehe AuthContext).
    for table in body.tables:
        if table == "data_history":
            # Entsteht immer als Nebeneffekt einer im selben Request bereits
            # geprüften Schreibung auf einer anderen Tabelle (siehe
            # frontend/src/db/write.ts: recordHistory()) — kein eigenes
            # Schreibrecht nötig. Sonst müsste jede Rolle mit irgendeinem
            # Schreibrecht zusätzlich explizit history:write bekommen, sonst
            # würde JEDER Push (nicht nur die History-Zeile) abgelehnt.
            continue
        area = TABLE_AREA.get(table)
        if area is None or f"{area}:write" not in user.permissions:
            raise HTTPException(status_code=403, detail=f"Keine Schreibrechte für {table}")

    accepted: dict[str, int] = {}
    async with pool.connection() as conn:
        for table, rows in body.tables.items():
            columns = SYNC_TABLES.get(table)
            if columns is None or not rows:
                continue
            geometry_cols = GEOMETRY_COLUMNS.get(table, set())
            set_clause = ", ".join(f'"{c}" = excluded."{c}"' for c in columns if c != "id")
            col_list = ", ".join(f'"{c}"' for c in columns)
            # Geometrie-Spalten (siehe schema/0007_postgis_geometry.sql) sind
            # server-seitig echtes PostGIS `geometry` — der Client schickt
            # aber weiterhin reinen GeoJSON-Text, deshalb hier explizit
            # konvertieren statt den rohen Wert zu binden. `excluded."{c}"`
            # im ON CONFLICT (oben) braucht dafür keine Änderung, da es den
            # bereits konvertierten Wert aus genau diesem Ausdruck referenziert.
            placeholders = ", ".join(
                f"ST_SetSRID(ST_GeomFromGeoJSON(%({c})s), 4326)" if c in geometry_cols else f"%({c})s"
                for c in columns
            )
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
            if table == "data_history":
                # Nur-Schreiben-Tabelle: der Verlauf wird zwar vom Client
                # hochgeschoben, aber nie heruntergezogen. Er ist die mit Abstand
                # grösste Tabelle (auf diesem Betrieb 13 von 15 MB) und wächst mit
                # jeder Änderung weiter — im Browser eines Telefons hat er nichts
                # verloren. Die Seite "Verlauf" liest ihn über /sync/history.
                continue
            area = TABLE_AREA.get(table)
            if area is None or f"{area}:read" not in user.permissions:
                # Tabelle wird komplett weggelassen statt leer zurückgegeben —
                # Daten ohne Leserecht landen so nie lokal in pglite.
                continue
            geometry_cols = GEOMETRY_COLUMNS.get(table, set())
            # ST_AsGeoJSON liefert für Geometrie-Spalten wieder reinen
            # GeoJSON-Text zurück — der Client sieht dadurch nie den echten
            # PostGIS-Typ, nur das gewohnte GeoJSON.
            col_list = ", ".join(
                f'ST_AsGeoJSON("{c}") as "{c}"' if c in geometry_cols else f'"{c}"' for c in columns
            )
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


@router.get("/sync/history", response_model=HistoryResponse)
async def history(
    limit: int = 300,
    before: str | None = None,
    user: CurrentUser = Depends(require_auth),
) -> HistoryResponse:
    """Der Änderungsverlauf, gelesen statt synchronisiert — siehe den Hinweis
    bei data_history in pull(). Liegt bewusst unter /sync/, damit die
    bestehende Traefik-Regel (`/<modul>/sync`) ihn ohne Änderung abdeckt."""
    area_name = TABLE_AREA.get("data_history")
    if area_name is None or f"{area_name}:read" not in user.permissions:
        raise HTTPException(status_code=403, detail="Kein Leserecht für den Verlauf")

    columns = SYNC_TABLES["data_history"]
    col_list = ", ".join(f'"{c}"' for c in columns)
    capped = max(1, min(limit, 1000))
    sql = f'select {col_list} from "data_history"'
    params: tuple = ()
    if before:
        # Weiterblättern über den Zeitstempel statt über OFFSET: der Verlauf
        # wächst vorne, ein OFFSET würde beim Nachladen Zeilen doppelt zeigen
        # oder überspringen.
        sql += " where changed_at < %s"
        params = (before,)
    sql += f" order by changed_at desc limit {capped}"

    async with pool.connection() as conn:
        rows = await (await conn.execute(sql, params)).fetchall()
    return HistoryResponse(
        entries=[{col: _jsonable(val) for col, val in zip(columns, row)} for row in rows]
    )


def _jsonable(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
