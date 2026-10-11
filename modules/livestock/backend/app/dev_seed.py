"""Testdaten für die lokale Instanz — nur mit DEV_SEED=true (nie auf dem Server).

Legt einmal einen Mastverlauf an, an dem sich der Mastplaner durchspielen
lässt: eine abgeschlossene Gruppe mit Schlachtresultaten (Markt und
Direktvermarktung, Gewichte und Klassen wie in den Vieh- und
Schlachtabrechnungen 2025/26), eine laufende Gruppe mit Wägungen bis heute
(einige knapp vor, einige schon im Proviande-Gewichtsabzug), ein altes Schaf,
Futter, Kosten, eine offene Absetzfrist und einen Proviande-Wochenpreis.

Läuft nur, wenn noch keine Testtiere da sind (Ohrmarken CH9999…), und
schreibt nur eigene Zeilen — vorhandene Daten bleiben unberührt. Wegräumen:
Tiere mit Quelle «Testdaten» in der App löschen oder die lokale DB neu
aufsetzen.
"""

import random
import uuid
from datetime import date, timedelta

from psycopg_pool import AsyncConnectionPool

TAG_PREFIX = "CH9999"
SOURCE = "Testdaten"


def _id() -> str:
    return str(uuid.uuid4())


async def seed_if_empty(pool: AsyncConnectionPool) -> int:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "select count(*) from animals where ear_tag like %s", (TAG_PREFIX + "%",)
        )
        if (await cur.fetchone())[0] > 0:
            return 0
        rnd = random.Random(42)
        today = date.today()
        rows: dict[str, list[dict]] = {k: [] for k in (
            "animals", "animal_groups", "group_memberships", "weighings", "medications",
            "feed_records", "expenses", "slaughter_results", "market_prices",
        )}
        n = 0

        def animal(birth: date, entry: date, weight: float, status: str = "aktiv", sex: str = "m") -> str:
            nonlocal n
            n += 1
            aid = _id()
            rows["animals"].append({
                "id": aid, "ear_tag": f"{TAG_PREFIX}{n:04d}", "birth_date": birth, "sex": sex,
                "status": status, "entry_date": entry, "entry_weight_kg": weight,
                "purchase_cost": 0, "source_name": SOURCE, "notes": "Testdaten (lokal)",
            })
            return aid

        def group(name: str, created: date, tmin: float, tmax: float, status: str) -> str:
            gid = _id()
            rows["animal_groups"].append({
                "id": gid, "name": name, "created_date": created, "target_weight_min_kg": tmin,
                "target_weight_max_kg": tmax, "status": status, "notes": SOURCE,
            })
            return gid

        def weigh_series(aid: str, start: date, end: date, w0: float, adg: float) -> float:
            d, w = start, w0
            while d <= end:
                rows["weighings"].append({"id": _id(), "animal_id": aid, "date": d, "weight_kg": round(w, 1)})
                d += timedelta(days=14)
                w += adg * 14 * rnd.uniform(0.85, 1.15)
            return w

        # Abgeschlossene Gruppe: Frühjahrslämmer, im Sommer geschlachtet.
        spring_start = today - timedelta(days=200)
        slaughter_day = today - timedelta(days=60)
        g_old = group("Test Frühling", spring_start, 40, 43, "abgeschlossen")
        # (SG kg, Klasse, Fett, Weg, Preis/kg bzw. Metzger, Verkaufswert)
        results = [
            (18.5, "T", "3", "markt", 14.90, None), (19.0, "H", "4", "markt", 14.30, None),
            (17.5, "T", "3", "markt", 14.90, None), (16.0, "T", "2", "markt", 14.60, None),
            (14.5, "A", "1", "markt", 12.70, None), (11.0, "A", "1", "markt", 9.00, None),
            (13.0, "T", "2", "direkt", 66.0, 235.0), (27.5, "T", "3", "direkt", 190.0, 495.0),
            (28.5, "H", "3", "direkt", 196.0, 510.0), (15.5, "H", "2", "markt", 15.00, None),
        ]
        for i, (sg, cls, fat, channel, price, value) in enumerate(results):
            birth = spring_start - timedelta(days=rnd.randint(40, 70))
            aid = animal(birth, spring_start, round(rnd.uniform(17, 22), 1), "geschlachtet", rnd.choice("mw"))
            rows["group_memberships"].append({
                "id": _id(), "animal_id": aid, "group_id": g_old, "start_date": spring_start, "end_date": slaughter_day,
            })
            weigh_series(aid, spring_start, slaughter_day - timedelta(days=3), 20, sg / 0.46 / 140)
            if channel == "markt":
                revenue, butcher, ppk = round(sg * price - 3.72, 2), None, price
            else:
                revenue, butcher, ppk = value, price, None
            rows["slaughter_results"].append({
                "id": _id(), "animal_id": aid, "slaughter_date": slaughter_day,
                "slaughterhouse": "Händler (Test)" if channel == "markt" else "Metzger (Test)",
                "carcass_weight_kg": sg, "classification": cls, "fat_class": fat, "price_per_kg": ppk,
                "total_revenue": revenue, "notes": SOURCE, "channel": channel, "butcher_cost": butcher,
            })
        rows["feed_records"].append({
            "id": _id(), "group_id": g_old, "date": spring_start + timedelta(days=30), "feed_type": "Lämmerwürfel",
            "quantity": 400, "unit": "kg", "cost_total": 380, "supplier": "Test", "notes": SOURCE,
        })
        rows["expenses"].append({
            "id": _id(), "group_id": g_old, "date": slaughter_day, "category": "Transport",
            "description": "Fuhre zum Schlachthof", "amount": 70,
        })

        # Laufende Gruppe: Wägungen alle zwei Wochen bis heute, verschieden schnell.
        autumn_start = today - timedelta(days=84)
        g_new = group("Test Herbst", autumn_start, 40, 43, "aktiv")
        for _ in range(12):
            birth = autumn_start - timedelta(days=rnd.randint(45, 80))
            aid = animal(birth, autumn_start, round(rnd.uniform(16, 24), 1), sex=rnd.choice("mw"))
            rows["group_memberships"].append({
                "id": _id(), "animal_id": aid, "group_id": g_new, "start_date": autumn_start, "end_date": None,
            })
            weigh_series(aid, autumn_start, today, rnd.uniform(16, 24), rnd.uniform(0.12, 0.33))
        first_new = rows["animals"][len(results)]["id"]
        rows["medications"].append({
            "id": _id(), "animal_id": first_new, "date": today - timedelta(days=5), "medication_name": "Testpräparat",
            "dose": "5 ml", "reason": "Test: offene Absetzfrist", "withdrawal_days": 28, "cost": 12.5,
        })
        rows["feed_records"].append({
            "id": _id(), "group_id": g_new, "date": autumn_start + timedelta(days=20), "feed_type": "Lämmerwürfel",
            "quantity": 300, "unit": "kg", "cost_total": 290, "supplier": "Test", "notes": SOURCE,
        })

        # Altes Schaf zum Ausmerzen: über 420 Tage, also Schafpreis.
        old = animal(today - timedelta(days=4 * 365), today - timedelta(days=30), 62, sex="w")
        rows["group_memberships"].append({
            "id": _id(), "animal_id": old, "group_id": g_new, "start_date": today - timedelta(days=30), "end_date": None,
        })
        rows["weighings"].append({"id": _id(), "animal_id": old, "date": today - timedelta(days=2), "weight_kg": 64.5})

        rows["market_prices"].append({
            "id": _id(), "valid_from": today - timedelta(days=1), "la_t3": 13.6, "sm_t3": 6.5, "bio_premium": 0,
            "fee_per_animal": 3.72, "source": "Proviande Woche 42/2026 (Test)", "notes": SOURCE,
        })

        async with conn.transaction():
            for table, items in rows.items():
                for row in items:
                    cols = list(row)
                    await conn.execute(
                        f'insert into "{table}" ({", ".join(cols)}) values ({", ".join(["%s"] * len(cols))})',
                        [row[c] for c in cols],
                    )
        return len(rows["animals"])
