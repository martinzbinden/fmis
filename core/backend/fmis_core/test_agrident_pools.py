"""Auswertung der Datenpool-Antworten des Lesegeräts (agrident.py). Formate nicht am Gerät bestätigt:
getestet wird die Toleranz und dass nichts geraten wird."""

import unittest

from core.backend.fmis_core.agrident import normalize_pool_tag, parse_pool_list, parse_pool_tags


class NormalizeTest(unittest.TestCase):
    def test_known_shapes(self) -> None:
        self.assertEqual(normalize_pool_tag("CH000900000103"), "CH000900000103")
        self.assertEqual(normalize_pool_tag("ch000900000103"), "CH000900000103")
        self.assertEqual(normalize_pool_tag("756000900000103"), "CH000900000103")
        self.assertEqual(normalize_pool_tag("000900000103"), "CH000900000103")
        self.assertEqual(normalize_pool_tag(" 756 0009 0000 0103 "), "CH000900000103")

    def test_rejects_the_rest(self) -> None:
        for bad in ["", "abc", "250000900000103", "CH12345", "75600090000010", "CH0009000001031"]:
            self.assertIsNone(normalize_pool_tag(bad), bad)


class PoolListTest(unittest.TestCase):
    def test_lines_and_fields(self) -> None:
        raw = "1|Weide Nord|23\r\n2|Stall|5\r\n"
        self.assertEqual(
            [(p["group_id"], p["name"], p["count"]) for p in parse_pool_list(raw)],
            [("1", "Weide Nord", 23), ("2", "Stall", 5)],
        )

    def test_missing_fields_and_noise(self) -> None:
        pools = parse_pool_list("7\n\n|ohne Kennung|3\n8|Nur Name\n9||x")
        self.assertEqual([(p["group_id"], p["name"], p["count"]) for p in pools], [("7", None, None), ("8", "Nur Name", None), ("9", None, None)])

    def test_empty(self) -> None:
        self.assertEqual(parse_pool_list(""), [])


class PoolTagsTest(unittest.TestCase):
    def test_tags_deduped_and_unknown_kept(self) -> None:
        raw = "CH000900000103|1|3\r\nCH000900000104|1|1\r\nCH000900000103|2|1\r\nirgendwas|x\r\n"
        tags, unknown = parse_pool_tags(raw)
        self.assertEqual(tags, ["CH000900000103", "CH000900000104"])
        self.assertEqual(unknown, ["irgendwas|x"])

    def test_empty(self) -> None:
        self.assertEqual(parse_pool_tags(""), ([], []))


if __name__ == "__main__":
    unittest.main()
