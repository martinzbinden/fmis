from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.backend.fmis_core.auth import CurrentUser, require_auth
from core.backend.fmis_core.db import get_pool
from core.backend.fmis_core.sync_push import push_rows
from core.backend.fmis_core.sync_stamps import pull_cursor
from .tables import FRIST_TABLES, GEOMETRY_COLUMNS, SYNC_TABLES, TABLE_AREA

# Eigener Pool mit search_path='betrieb,public' (siehe fmis_core/db.py)
# — die untenstehenden Queries bleiben dadurch unqualifiziert und landen
# trotzdem im richtigen Postgres-Schema.
pool = get_pool("betrieb")

router = APIRouter()


class PushRequest(BaseModel):
    tables: dict[str, list[dict[str, Any]]]


class RejectedRow(BaseModel):
    table: str
    id: str
    reason: str  # forbidden | invalid | unknown_table
    detail: str
    # Stand des Servers, wenn die Änderung wegen der Korrekturfrist abgelehnt wurde
    current: dict[str, Any] | None = None


class PushResponse(BaseModel):
    accepted: dict[str, int]
    rejected: list[RejectedRow] = []


class PullResponse(BaseModel):
    server_time: str
    tables: dict[str, list[dict[str, Any]]]
class HistoryResponse(BaseModel):
    entries: list[dict[str, Any]]


@router.post("/sync/push", response_model=PushResponse)
async def push(body: PushRequest, user: CurrentUser = Depends(require_auth), atomic: bool = False) -> PushResponse:
    # Zeilenweise (core/backend/fmis_core/sync_push.py): abgelehnte Zeilen blockieren den Rest nicht.
    return PushResponse(**await push_rows(pool, body.tables, user, SYNC_TABLES, TABLE_AREA, GEOMETRY_COLUMNS, atomic=atomic, frist_tables=FRIST_TABLES))


@router.get("/sync/pull", response_model=PullResponse)
async def pull(since: str | None = None, user: CurrentUser = Depends(require_auth)) -> PullResponse:
    tables: dict[str, list[dict[str, Any]]] = {}
    async with pool.connection() as conn:
        # Server-Ankunftszeit statt Gerätezeit (fmis_core/sync_stamps.py)
        server_time = await pull_cursor(conn)
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
                continue
            geometry_cols = GEOMETRY_COLUMNS.get(table, set())
            # ST_AsGeoJSON liefert für Geometrie-Spalten wieder reinen
            # GeoJSON-Text zurück — der Client sieht dadurch nie den echten
            # PostGIS-Typ, nur das gewohnte GeoJSON.
            col_list = ", ".join(
                f'ST_AsGeoJSON("{c}") as "{c}"' if c in geometry_cols else f'"{c}"' for c in columns
            )
            if since:
                sql = f'select {col_list} from "{table}" where synced_at > %s'
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
