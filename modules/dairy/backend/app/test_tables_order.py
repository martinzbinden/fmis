"""Reihenfolge der Sync-Tabellen: Verweise (Fremdschlüssel) zeigen auf frühere Tabellen."""

import unittest

from modules.dairy.backend.app.tables import SYNC_TABLES


class TableOrderTest(unittest.TestCase):
    def test_offspring_before_journal(self) -> None:
        order = list(SYNC_TABLES)
        self.assertLess(order.index("births"), order.index("birth_offspring"))
        self.assertLess(order.index("birth_offspring"), order.index("animal_journal"))
        self.assertLess(order.index("animal_journal"), order.index("journal_photos"))


if __name__ == "__main__":
    unittest.main()
