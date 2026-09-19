import os
from pathlib import Path

from psycopg_pool import AsyncConnectionPool

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://fmis:fmis@localhost:5432/fmis")

# core/backend/fmis_core/schema — die geteilten, serverseitigen Core-Tabellen
# (roles/users/login_tokens/modules), landen im Schema 'public'.
CORE_SCHEMA_DIR = Path(__file__).resolve().parent / "schema"

# Ein Connection-Pool pro Postgres-Schema (Modul-Key, oder 'public' für die
# geteilten Core-Tabellen) — der search_path ist pro Pool fix eingestellt,
# damit jedes Modul seine bestehenden, unqualifizierten SQL-Statements
# (z.B. `select * from "animals"` in modules/<name>/backend/app/sync.py)
# unverändert weiterverwenden kann: sie landen über den search_path
# automatisch im richtigen Schema, ohne dass eine einzige Query angepasst
# werden muss.
_pools: dict[str, AsyncConnectionPool] = {}


def get_pool(schema: str = "public") -> AsyncConnectionPool:
    if schema not in _pools:
        options = "-c search_path=public" if schema == "public" else f"-c search_path={schema},public"
        _pools[schema] = AsyncConnectionPool(DATABASE_URL, kwargs={"options": options}, open=False)
    return _pools[schema]


async def open_pools() -> None:
    for pool in _pools.values():
        await pool.open()


async def close_pools() -> None:
    for pool in _pools.values():
        await pool.close()


async def run_migrations() -> None:
    """Wendet zuerst core/backend/fmis_core/schema/*.sql an (geteilte
    Auth-/Modul-Tabellen, Schema 'public'), danach je registriertem Modul
    dessen modules/<key>/schema/*.sql (dasselbe Schema, das auch
    client-seitig in pglite läuft, unverändert) in einem eigenen
    Postgres-Schema. Getrackt in public.schema_migrations(module, version) —
    die module-Spalte verhindert, dass gleichnamige Dateien aus
    verschiedenen Modulen (z.B. 0001_init.sql in allen drei modules/*/schema/)
    kollidieren.
    """
    from .module_registry import MODULE_SPECS  # lazy: vermeidet Zirkular-Import mit modules_admin

    public_pool = get_pool("public")
    async with public_pool.connection() as conn:
        await conn.execute(
            """
            create table if not exists schema_migrations (
              module text not null,
              version text not null,
              applied_at timestamptz not null default now(),
              primary key (module, version)
            )
            """
        )
        await conn.commit()

    await _apply_migrations("core", sorted(CORE_SCHEMA_DIR.glob("*.sql")), public_pool)

    for spec in MODULE_SPECS:
        async with public_pool.connection() as conn:
            await conn.execute(f'create schema if not exists "{spec.key}"')
            await conn.commit()
        await _apply_migrations(spec.key, sorted(spec.schema_dir.glob("*.sql")), get_pool(spec.key))


async def _apply_migrations(module: str, files: list[Path], pool: AsyncConnectionPool) -> None:
    async with pool.connection() as conn:
        applied = {
            row[0]
            for row in await (
                await conn.execute(
                    "select version from schema_migrations where module = %s", (module,)
                )
            ).fetchall()
        }
        for path in files:
            if path.name in applied:
                continue
            sql = path.read_text()
            async with conn.transaction():
                await conn.execute(sql)  # type: ignore[arg-type]
                await conn.execute(
                    "insert into schema_migrations (module, version) values (%s, %s)",
                    (module, path.name),
                )
