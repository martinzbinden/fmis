from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .auth import require_auth
from .db import pool
from .tables import SYNC_TABLES

router = APIRouter(dependencies=[Depends(require_auth)])


class PushRequest(BaseModel):
    tables: dict[str, list[dict[str, Any]]]


class PushResponse(BaseModel):
    accepted: dict[str, int]


class PullResponse(BaseModel):
    server_time: str
    tables: dict[str, list[dict[str, Any]]]


@router.post("/sync/push", response_model=PushResponse)
async def push(body: PushRequest) -> PushResponse:
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
async def pull(since: str | None = None) -> PullResponse:
    tables: dict[str, list[dict[str, Any]]] = {}
    async with pool.connection() as conn:
        server_time_row = await (await conn.execute("select now()")).fetchone()
        server_time = server_time_row[0].isoformat()
        for table, columns in SYNC_TABLES.items():
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


def _jsonable(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
