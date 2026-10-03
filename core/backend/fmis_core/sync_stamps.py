"""Server-Zeitstempel für den Pull ("seit wann beim Server angekommen").

Problem (2026-10-03 gefunden): Der Pull lieferte Zeilen mit
`updated_at > since`. updated_at setzt aber das GERÄT beim Schreiben — ein
K03-Import baut seine Zeilen zuerst in einer Import-Sitzung im Speicher auf
und schickt sie erst danach. Jedes Gerät, das zwischen Schreiben (16:33) und
Ankunft beim Server synchronisiert hatte, stand mit `since` schon dahinter
und hat die 54 Schafwägungen vom 25.9. nie bekommen. Dasselbe passiert bei
offline erfassten Daten oder einer falsch gehenden Geräteuhr.

Lösung: jede Sync-Tabelle bekommt serverseitig `synced_at`, gesetzt per
Trigger bei jedem insert/update (egal ob Push, Server-Import oder
Migration) mit clock_timestamp(). Der Pull filtert darauf; updated_at bleibt
für Last-Write-Wins. Die Spalte gibt es nur auf dem Server (nicht in
SYNC_TABLES, nicht in pglite).

`ensure_sync_stamps` läuft bei jedem Start nach den Migrationen und ist
idempotent — neue Tabellen künftiger Migrationen bekommen Spalte und Trigger
automatisch.
"""

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

STAMP_COLUMN = "synced_at"


async def ensure_sync_stamps(pool: AsyncConnectionPool, schema: str) -> None:
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                create or replace function public.fmis_stamp_synced_at() returns trigger
                language plpgsql as $$
                begin
                  new.synced_at := clock_timestamp();
                  return new;
                end $$
                """
            )
            tables = [
                r[0]
                for r in await (
                    await conn.execute(
                        """
                        select c.table_name from information_schema.columns c
                        join information_schema.tables t
                          on t.table_schema = c.table_schema and t.table_name = c.table_name
                        where c.table_schema = %s and c.column_name = 'updated_at'
                          and t.table_type = 'BASE TABLE'
                        """,
                        (schema,),
                    )
                ).fetchall()
            ]
            for table in tables:
                q = f'"{schema}"."{table}"'
                await conn.execute(f"alter table {q} add column if not exists {STAMP_COLUMN} timestamptz")
                # Bestehende Zeilen: bisheriger Zeitstempel (vor dem Trigger,
                # sonst bekämen alle "jetzt")
                await conn.execute(f"update {q} set {STAMP_COLUMN} = updated_at where {STAMP_COLUMN} is null")
                await conn.execute(f'create index if not exists "{table}_{STAMP_COLUMN}_idx" on {q} ({STAMP_COLUMN})')
                await conn.execute(
                    f"create or replace trigger fmis_stamp_synced_at before insert or update on {q} "
                    "for each row execute function public.fmis_stamp_synced_at()"
                )


async def pull_cursor(conn: AsyncConnection) -> str:
    """Zeitpunkt, bis zu dem dieser Pull sicher alles sieht: jetzt, oder
    früher, solange noch eine andere Transaktion offen ist (ein laufender
    Push stempelt mit clock_timestamp() ≥ seinem Transaktionsbeginn, wird
    aber erst später sichtbar — der nächste Pull holt ihn so nach)."""
    row = await (
        await conn.execute(
            """
            select least(now(), coalesce(min(xact_start), now()))
            from pg_stat_activity
            where datname = current_database() and backend_type = 'client backend'
              and pid <> pg_backend_pid() and xact_start is not null
            """
        )
    ).fetchone()
    return row[0].isoformat()
