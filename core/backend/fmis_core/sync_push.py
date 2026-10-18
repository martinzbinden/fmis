"""Gemeinsamer Push-Handler aller Module (POST /<modul>/sync/push).

Jede Zeile wird in einem eigenen Savepoint geschrieben und einzeln
quittiert. Früher lief der ganze Push in EINER Transaktion: eine einzige
fehlerhafte Zeile (z.B. verletzter CHECK) oder ein fehlendes Schreibrecht für
EINE Tabelle lehnte alles ab — das Gerät schickte danach immer dasselbe Paket
und scheiterte immer wieder, alle neueren Eingaben blieben im Handy hängen.

Jetzt: akzeptierte Zeilen werden committet, abgelehnte kommen mit Grund in
`rejected` zurück. Der Client behält diese in der Outbox und zeigt sie an.
"""

from typing import Any, Iterable, Mapping

import psycopg
from fastapi import HTTPException
from psycopg_pool import AsyncConnectionPool

from .auth import CurrentUser


def _reason(exc: psycopg.Error) -> str:
    """Kurzer, lesbarer Grund — ohne Zeilenwerte (die Meldungen von
    Postgres nennen Spalten und Regeln, nicht die Daten selbst)."""
    diag = exc.diag
    text = diag.message_primary or str(exc).splitlines()[0]
    if diag.constraint_name and diag.constraint_name not in text:
        text = f"{text} [{diag.constraint_name}]"
    return text[:300]


async def push_rows(
    pool: AsyncConnectionPool,
    tables: Mapping[str, list[dict[str, Any]]],
    user: CurrentUser,
    sync_tables: Mapping[str, Iterable[str]],
    area_of: Mapping[str, str] | Any,
    geometry_columns: Mapping[str, set[str]] | None = None,
    atomic: bool = False,
) -> dict[str, Any]:
    """Schreibt `tables` zeilenweise. `area_of` ordnet jede Tabelle ihrem
    Rechtebereich zu (dict oder Funktion `table -> area | None`).
    `atomic=True` (Import, ?atomic=1): wird auch nur EINE Zeile abgelehnt, wird nichts
    geschrieben und mit 422 geantwortet — ein Import soll nie halb übernommen sein.
    Rückgabe: {"accepted": {tabelle: anzahl}, "rejected": [{table, id, reason, detail}]}."""
    geometry_columns = geometry_columns or {}
    lookup = area_of if callable(area_of) else area_of.get
    accepted: dict[str, int] = {}
    rejected: list[dict[str, Any]] = []

    def reject(table: str, row: Mapping[str, Any], reason: str, detail: str) -> None:
        rejected.append({"table": table, "id": str(row.get("id")), "reason": reason, "detail": detail})

    async with pool.connection() as conn:
        # Äussere Transaktion eröffnen: `conn.transaction()` legt dann je
        # Zeile nur einen Savepoint an statt je Zeile zu committen (ein
        # Import schickt tausende Zeilen).
        await conn.execute("select 1")
        for table, rows in tables.items():
            if not rows:
                continue
            columns = list(sync_tables.get(table) or [])
            if not columns:
                for row in rows:
                    reject(table, row, "unknown_table", f"Unbekannte Tabelle {table}")
                continue
            # data_history entsteht immer als Nebeneffekt einer im selben
            # Request geprüften Schreibung (frontend db/write.ts:
            # recordHistory()) — kein eigenes Schreibrecht nötig, sonst
            # würde jede Rolle mit irgendeinem Schreibrecht zusätzlich
            # history:write brauchen.
            if table != "data_history":
                area = lookup(table)
                if area is None or f"{area}:write" not in user.permissions:
                    for row in rows:
                        reject(table, row, "forbidden", f"Keine Schreibrechte für {table}")
                    continue

            geometry_cols = geometry_columns.get(table, set())
            set_clause = ", ".join(f'"{c}" = excluded."{c}"' for c in columns if c != "id")
            col_list = ", ".join(f'"{c}"' for c in columns)
            # Geometrie-Spalten sind serverseitig echtes PostGIS `geometry`;
            # der Client schickt reinen GeoJSON-Text, deshalb hier explizit
            # konvertieren (`excluded."{c}"` im ON CONFLICT referenziert den
            # bereits konvertierten Wert).
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
            for row in rows:
                if not row.get("id"):
                    reject(table, row, "invalid", "Zeile ohne id")
                    continue
                params = {c: row.get(c) for c in columns}
                try:
                    # Savepoint: scheitert die Zeile, bleiben alle anderen gültig
                    async with conn.transaction():
                        await conn.execute(sql, params)
                    count += 1
                except psycopg.Error as exc:
                    reject(table, row, "invalid", _reason(exc))
            accepted[table] = count
        if atomic and rejected:
            # Austritt mit Exception → der Pool rollt die Transaktion zurück
            raise HTTPException(status_code=422, detail={"message": "Zeilen abgelehnt", "rejected": rejected[:50]})
        await conn.commit()
    return {"accepted": accepted, "rejected": rejected}
