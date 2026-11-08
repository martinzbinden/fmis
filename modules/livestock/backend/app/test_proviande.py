"""Proviande-PDFs auslesen (Text von pdftotext -layout, Woche 46/2026). Ohne Datenbank, im Backend-Container:
python -m unittest modules.livestock.backend.app.test_proviande
"""

import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from modules.livestock.backend.app.proviande import parse

DATA = Path(__file__).parent / "testdata"


class ParseProviande(unittest.TestCase):
    def test_schafe(self):
        r = parse((DATA / "proviande_schafe_2026w46.txt").read_text())
        self.assertEqual(r["week"], "46/2026")
        self.assertEqual(r["valid_from"], date(2026, 11, 9))
        self.assertEqual(r["prices"][("LA", "T")], {"sg": Decimal("13.40"), "lg": Decimal("6.15")})
        self.assertEqual(r["prices"][("SM", "T")]["sg"], Decimal("6.30"))
        self.assertEqual(r["prices"][("LA", "X")]["sg"], Decimal("10.80"))
        self.assertEqual(r["prices"][("WP", "C")], {"lg": Decimal("5.85")})

    def test_rindvieh_beide_seiten(self):
        r = parse((DATA / "proviande_rindvieh_2026w46.txt").read_text())
        self.assertEqual(r["valid_from"], date(2026, 11, 9))
        self.assertEqual(r["prices"][("KV", "T")], {"sg": Decimal("18.30")})
        self.assertEqual(r["prices"][("VK", "T")]["sg"], Decimal("10.00"))
        self.assertEqual(r["prices"][("MT", "+")]["sg"], Decimal("11.70"))
        # unvollständige Zeilen (RG ab A) werden nicht falsch zugeordnet
        self.assertNotIn(("KV", "A"), r["prices"])

    def test_ohne_preise_fehler(self):
        with self.assertRaises(ValueError):
            parse("46/2026\nGültig ab: 09.11.2026\nnichts")


if __name__ == "__main__":
    unittest.main()
