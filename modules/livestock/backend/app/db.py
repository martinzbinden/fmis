import os
from pathlib import Path

from psycopg_pool import AsyncConnectionPool

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://mastplaner:mastplaner@localhost:5432/mastplaner"
)
# Default assumes running from backend/ during local dev (schema/ is one level up).
SCHEMA_DIR = Path(os.environ.get("SCHEMA_DIR", Path(__file__).resolve().parents[2] / "schema"))
# Nutzer/Rollen/Login-Tokens: nur serverseitig, NICHT Teil des geteilten
# schema/*.sql, das auch client-seitig in pglite läuft (siehe backend/schema/0001_auth.sql).
AUTH_SCHEMA_DIR = Path(
    os.environ.get("AUTH_SCHEMA_DIR", Path(__file__).resolve().parents[1] / "schema")
)

pool = AsyncConnectionPool(DATABASE_URL, open=False)


async def run_migrations() -> None:
    """Applies schema/*.sql (geteilt, auch in pglite) und backend/schema/*.sql
    (nur serverseitig) in Dateinamen-Reihenfolge an, getrackt in derselben
    schema_migrations-Tabelle. Mirrors the migration runner in
    frontend/src/db/pglite.ts for the shared schema half.
    """
    migration_files = sorted(SCHEMA_DIR.glob("*.sql")) + sorted(AUTH_SCHEMA_DIR.glob("*.sql"))
    async with pool.connection() as conn:
        await conn.execute(
            """
            create table if not exists schema_migrations (
              version text primary key,
              applied_at timestamptz not null default now()
            )
            """
        )
        applied = {
            row[0]
            for row in (await (await conn.execute("select version from schema_migrations")).fetchall())
        }
        for path in migration_files:
            if path.name in applied:
                continue
            sql = path.read_text()
            async with conn.transaction():
                await conn.execute(sql)  # type: ignore[arg-type]
                await conn.execute(
                    "insert into schema_migrations (version) values (%s)", (path.name,)
                )
