"""Was die Zeit-App am Kalender-Link liest (siehe duty_feed.py). Ohne Datenbank, im Backend-Container:
python -m unittest modules.betrieb.backend.app.test_duty_feed
"""

import unittest
from datetime import date, datetime

from modules.betrieb.backend.app.duty_feed import build_ics

SHIFT_ID = "11111111-2222-4333-8444-555555555555"


def shift(**extra):
    return {"id": SHIFT_ID, "date": date(2026, 11, 7), "start_time": "16:30", "duration_min": 90, "type_name": "Stall, Abend", **extra}


def ics(*shifts, scope="person"):
    return build_ics("Dienste", list(shifts), datetime(2026, 11, 6, 12, 0), scope)


class FeedContract(unittest.TestCase):
    def test_scope_steht_im_kalender(self):
        self.assertIn("\r\nX-FMIS-SCOPE:person\r\n", ics(scope="person"))
        self.assertIn("\r\nX-FMIS-SCOPE:alle\r\n", ics(scope="alle"))

    def test_felder_eines_dienstes(self):
        text = ics(shift())
        self.assertIn(f"\r\nUID:{SHIFT_ID}@fmis.riedackerhof.ch\r\n", text)
        self.assertIn("\r\nDTSTART;TZID=Europe/Zurich:20261107T163000\r\n", text)
        self.assertIn("\r\nDTEND;TZID=Europe/Zurich:20261107T180000\r\n", text)
        self.assertIn("\r\nSUMMARY:Stall\\, Abend\r\n", text)

    def test_nur_entwurf_ist_vorlaeufig(self):
        self.assertNotIn("STATUS:", ics(shift()))
        self.assertIn("\r\nSTATUS:TENTATIVE\r\nEND:VEVENT\r\n", ics(shift(tentative=True)))

    def test_lange_zeilen_sind_umbrochen(self):
        self.assertIn("\r\n ", ics(shift(type_name="Stall " * 30)))


if __name__ == "__main__":
    unittest.main()
