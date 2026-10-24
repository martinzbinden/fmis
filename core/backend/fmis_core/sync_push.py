"""Gemeinsamer Push-Handler aller Module (POST /<modul>/sync/push).

Jede Zeile wird in einem eigenen Savepoint geschrieben und einzeln
quittiert. Früher lief der ganze Push in EINER Transaktion: eine einzige
fehlerhafte Zeile (z.B. verletzter CHECK) oder ein fehlendes Schreibrecht für
EINE Tabelle lehnte alles ab — das Gerät schickte danach immer dasselbe Paket
und scheiterte immer wieder, alle neueren Eingaben blieben im Handy hängen.

Jetzt: akzeptierte Zeilen werden committet, abgelehnte kommen mit Grund in
`rejected` zurück. Der Client behält diese in der Outbox und zeigt sie an.
"""

from typing import Any, Awaitable, Callable, Iterable, Mapping

import psycopg
from fastapi import HTTPException
from psycopg_pool import AsyncConnectionPool

from .auth import CurrentUser


# Recht «nachträglich ändern/stornieren»: wer es nicht hat (Mitarbeit), darf
# einen Eintrag der FRIST_TABLES nur während KORREKTUR_FRIST_MIN Minuten nach
# seinem ersten Eintreffen auf dem Server ändern oder stornieren (Storno =
# deleted_at setzen, also ebenfalls eine Änderung).
KORREKTUR_PERMISSION = "core:korrektur:write"
# Recht «Daten importieren»: Importe laufen als atomarer Push (?atomic=1)
IMPORT_PERMISSION = "core:import:write"
KORREKTUR_FRIST_MIN = 10

# Prüfung einer einzelnen Zeile durch das Modul (z.B. Anträge im Dienstplan):
# gibt einen Ablehnungsgrund zurück oder None. Läuft vor dem Schreiben.
RowGuard = Callable[[Any, str, Mapping[str, Any], CurrentUser], Awaitable[str | None]]
# Nach dem Schreiben einer Zeile (gleiche Transaktion), mit dem Stand davor (None = neu):
# z.B. Benachrichtigungen oder serverseitige Folgeänderungen. Nur für `watch`-Tabellen.
AfterWrite = Callable[[Any, str, Mapping[str, Any], dict[str, Any] | None, CurrentUser], Awaitable[None]]


class _Veto(Exception):
    def __init__(self, reason: str, detail: str, current: dict[str, Any] | None = None) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail
        self.current = current


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
    frist_tables: Iterable[str] = (),
    guard: RowGuard | None = None,
    frist_filters: Mapping[str, str] | None = None,
    after_write: AfterWrite | None = None,
    watch: Iterable[str] = (),
) -> dict[str, Any]:
    """Schreibt `tables` zeilenweise. `area_of` ordnet jede Tabelle ihrem
    Rechtebereich zu (dict oder Funktion `table -> area | None`).
    `atomic=True` (Import, ?atomic=1): wird auch nur EINE Zeile abgelehnt, wird nichts
    geschrieben und mit 422 geantwortet — ein Import soll nie halb übernommen sein.
    `frist_tables`: Erfassungs-Tabellen mit Korrekturfrist (siehe KORREKTUR_PERMISSION).
    `frist_filters`: je Tabelle eine feste SQL-Bedingung, auf welche Zeilen die Frist gilt
    (z.B. nur selbst erfasste, nicht importierte oder automatisch nachgeführte).
    `guard`: Zeilenprüfung des Moduls (siehe RowGuard).
    `atomic` (Import) braucht IMPORT_PERMISSION.
    Rückgabe: {"accepted": {tabelle: anzahl}, "rejected": [{table, id, reason, detail, current?}]}."""
    geometry_columns = geometry_columns or {}
    lookup = area_of if callable(area_of) else area_of.get
    accepted: dict[str, int] = {}
    rejected: list[dict[str, Any]] = []

    if atomic and IMPORT_PERMISSION not in user.permissions:
        raise HTTPException(status_code=403, detail=f"Fehlende Berechtigung: {IMPORT_PERMISSION}")
    frist = set(frist_tables) if KORREKTUR_PERMISSION not in user.permissions else set()
    filters = frist_filters or {}
    watched = set(watch) if after_write else set()

    def reject(table: str, row: Mapping[str, Any], reason: str, detail: str, current: dict[str, Any] | None = None) -> None:
        entry: dict[str, Any] = {"table": table, "id": str(row.get("id")), "reason": reason, "detail": detail}
        if current is not None:
            entry["current"] = current
        rejected.append(entry)

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
                        if table in frist:
                            await _check_frist(conn, table, columns, geometry_cols, row, filters.get(table))
                        if guard is not None:
                            why = await guard(conn, table, row, user)
                            if why:
                                raise _Veto("forbidden", why)
                        old = await _row(conn, table, row.get("id")) if table in watched else None
                        res = await conn.execute(sql, params)
                        # nur wenn die Zeile wirklich geschrieben wurde (nicht ein älterer Stand)
                        if table in watched and res.rowcount:
                            await after_write(conn, table, params, old, user)
                    count += 1
                except _Veto as veto:
                    reject(table, row, veto.reason, veto.detail, veto.current)
                except psycopg.Error as exc:
                    reject(table, row, "invalid", _reason(exc))
            accepted[table] = count
        if atomic and rejected:
            # Austritt mit Exception → der Pool rollt die Transaktion zurück
            raise HTTPException(status_code=422, detail={"message": "Zeilen abgelehnt", "rejected": rejected[:50]})
        await conn.commit()
    return {"accepted": accepted, "rejected": rejected}


async def _check_frist(conn: Any, table: str, columns: list[str], geometry_cols: set[str], row: Mapping[str, Any], only_where: str | None = None) -> None:
    """Wirft _Veto, wenn die Zeile schon länger als die Korrekturfrist auf dem
    Server liegt und diese Fassung sie tatsächlich ändern würde (eine
    wiederholte Zustellung desselben Stands bleibt wirkungslos und wird nicht
    beanstandet). `current` ist der Stand des Servers, damit das Gerät seine
    Änderung zurücknehmen kann."""
    extra = f" and ({only_where})" if only_where else ""
    found = await (
        await conn.execute(
            f"""
            select first_synced_at < clock_timestamp() - make_interval(mins => %s)
                   and updated_at < %s::timestamptz
            from "{table}" where id = %s{extra}
            """,
            (KORREKTUR_FRIST_MIN, row.get("updated_at"), row.get("id")),
        )
    ).fetchone()
    if not found or not found[0]:
        return
    col_list = ", ".join(
        f'ST_AsGeoJSON("{c}") as "{c}"' if c in geometry_cols else f'"{c}"' for c in columns
    )
    current = await (await conn.execute(f'select {col_list} from "{table}" where id = %s', (row.get("id"),))).fetchone()
    raise _Veto(
        "frist",
        f"Nach {KORREKTUR_FRIST_MIN} Minuten kann nur noch das Büro ändern oder stornieren",
        {c: (v.isoformat() if hasattr(v, "isoformat") else v) for c, v in zip(columns, current)} if current else None,
    )


async def _row(conn: Any, table: str, row_id: Any) -> dict[str, Any] | None:
    cur = await conn.execute(f'select * from "{table}" where id = %s', (row_id,))
    found = await cur.fetchone()
    if found is None:
        return None
    return {d.name: v for d, v in zip(cur.description, found)}

