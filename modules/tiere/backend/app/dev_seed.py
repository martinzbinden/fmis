"""Testdaten für die lokale Instanz — nur mit DEV_SEED=true (nie auf dem Server).

Zwei Testgruppen («Test Milchschafe», «Test Rinder») mit Tierzahlen, Stall
mit zeitweisem Laufhof und Weide-Aufenthalten 2024 bis heute, dazu
Laufhofgänge im Winter — damit sich Auslaufjournal, Weidenutzung je Monat und
der Jahresvergleich durchspielen lassen.

Läuft nur, wenn es noch keine Gruppe «Test …» gibt, und schreibt nur eigene
Zeilen. Wegräumen: die Testgruppen in der App löschen.
"""

import uuid
from datetime import date, timedelta

from psycopg_pool import AsyncConnectionPool

PREFIX = "Test "


def _id() -> str:
    return str(uuid.uuid4())


async def seed_if_empty(pool: AsyncConnectionPool) -> int:
    async with pool.connection() as conn:
        cur = await conn.execute("select count(*) from herd_groups where name like %s", (PREFIX + "%",))
        if (await cur.fetchone())[0] > 0:
            return 0
        today = date.today()
        stall, weide = _id(), _id()
        await conn.execute(
            "insert into locations (id, name, kind, laufhof, sort_order) values (%s, %s, 'stall', 'zeitweise', 90), (%s, %s, 'weide', 'keiner', 91)",
            (stall, PREFIX + "Stall", weide, PREFIX + "Weide"),
        )
        groups = [
            (_id(), PREFIX + "Milchschafe", "schafe", True, "auen_gemolken", 40),
            (_id(), PREFIX + "Rinder", "rinder", False, "rinder", 12),
        ]
        # Weidezeiten je Gruppe (Jahr, von, bis); Rinder mit Lücke im Juli
        seasons = {
            0: [(2024, (4, 10), (10, 31)), (2025, (4, 2), (11, 8)), (2026, (4, 5), (10, 20))],
            1: [(2024, (5, 1), (6, 30)), (2024, (7, 15), (9, 30)), (2025, (4, 25), (6, 30)), (2025, (7, 10), (10, 5)), (2026, (5, 3), (9, 28))],
        }
        start = date(2024, 1, 1)
        for i, (gid, name, species, milking, cat, n) in enumerate(groups):
            await conn.execute(
                "insert into herd_groups (id, name, species, milking, sort_order) values (%s, %s, %s, %s, %s)",
                (gid, name, species, milking, 90 + i),
            )
            await conn.execute(
                "insert into herd_counts (id, group_id, category, count, from_date) values (%s, %s, %s, %s, %s)",
                (_id(), gid, cat, n, start),
            )
            await conn.execute(
                "insert into herd_stays (id, group_id, slot, location_id, from_date) values (%s, %s, 'stall', %s, %s)",
                (_id(), gid, stall, start),
            )
            for year, f, t in seasons[i]:
                a, b = date(year, *f), date(year, *t)
                if a > today:
                    continue
                await conn.execute(
                    "insert into herd_stays (id, group_id, slot, location_id, from_date, to_date) values (%s, %s, 'weide', %s, %s, %s)",
                    (_id(), gid, weide, a, min(b, today)),
                )
            # Laufhofgänge im Winter: Schafe jeden zweiten Tag, Rinder jeden dritten
            d = start
            step = 2 if i == 0 else 3
            while d <= today:
                if d.month >= 11 or d.month <= 3:
                    await conn.execute(
                        "insert into herd_laufhof (id, group_id, entry_date) values (%s, %s, %s)",
                        (_id(), gid, d),
                    )
                d += timedelta(days=step)
        return len(groups)
