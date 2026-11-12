"""Auswertung der Datenpool-Antworten des Lesegeräts (agrident.py). Beispiele stammen aus echten Antworten
des APR600 (12.11.2026); Ohrmarken sind unverändert aus dem Mitschnitt von Testtieren."""

import unittest

from core.backend.fmis_core.agrident import normalize_pool_tag, parse_device_time, parse_pool_list, parse_pool_tags

GROUPS = "[0|1|ML|0]\r\n[1|2|Mw 1|0]\r\n[2|3|Mw .1|3]\r\n[7|8|mwneu|42]\r\n[37|38|m5|257]"
GROUP_3 = (
    "[XGGROUP|3]\r\n"
    "[0|18042026|003014|0|0|FDX|0756000021727967||]\r\n"
    "[1|18042026|004059|0|0|FDX|0756000021727968|9999|]\r\n"
    "[2|18042026|004216|0|0|FDX|0756000021727969|9999|]"
)


class NormalizeTest(unittest.TestCase):
    def test_known_shapes(self) -> None:
        self.assertEqual(normalize_pool_tag("CH000021727967"), "CH000021727967")
        self.assertEqual(normalize_pool_tag("ch000021727967"), "CH000021727967")
        self.assertEqual(normalize_pool_tag("0756000021727967"), "CH000021727967")  # Gerät: führende 0
        self.assertEqual(normalize_pool_tag("756000021727967"), "CH000021727967")
        self.assertEqual(normalize_pool_tag("000021727967"), "CH000021727967")
        self.assertEqual(normalize_pool_tag(" 756 0000 2172 7967 "), "CH000021727967")

    def test_rejects_the_rest(self) -> None:
        for bad in ["", "abc", "250000021727967", "CH12345", "75600002172796", "CH0000217279671", "Gruppen-Separator"]:
            self.assertIsNone(normalize_pool_tag(bad), bad)


class PoolListTest(unittest.TestCase):
    def test_real_device_lines(self) -> None:
        pools = parse_pool_list(GROUPS)
        self.assertEqual([(p["group_id"], p["name"], p["count"]) for p in pools], [("1", "ML", 0), ("2", "Mw 1", 0), ("3", "Mw .1", 3), ("8", "mwneu", 42), ("38", "m5", 257)])

    def test_noise_and_missing_fields(self) -> None:
        pools = parse_pool_list("[0|7]\n\n[1||x|3]\nkein record\n[2|9|Nur Name]")
        self.assertEqual([(p["group_id"], p["name"], p["count"]) for p in pools], [("7", None, None), ("9", "Nur Name", None)])

    def test_empty(self) -> None:
        self.assertEqual(parse_pool_list(""), [])


class PoolTagsTest(unittest.TestCase):
    def test_real_group(self) -> None:
        tags, unknown, latest = parse_pool_tags(GROUP_3)
        self.assertEqual(tags, ["CH000021727967", "CH000021727968", "CH000021727969"])
        self.assertEqual(unknown, [])
        self.assertEqual(latest, "2026-04-18T00:42:16")

    def test_echo_is_not_a_record_and_duplicates_collapse(self) -> None:
        raw = GROUP_3 + "\r\n[3|18042026|004300|0|0|FDX|0756000021727967||]"
        tags, _, _ = parse_pool_tags(raw)
        self.assertEqual(len(tags), 3)

    def test_unparsable_record_kept_apart(self) -> None:
        tags, unknown, _ = parse_pool_tags("[XGGROUP|1]\r\n[0|18042026|003014|0|0|FDX|keine nummer||]\r\n[1|18042026|003015|0|0|FDX|0756000021727967||]")
        self.assertEqual(tags, ["CH000021727967"])
        self.assertEqual(len(unknown), 1)

    def test_empty_and_echo_only(self) -> None:
        self.assertEqual(parse_pool_tags(""), ([], [], None))
        self.assertEqual(parse_pool_tags("[XGGROUP|1]"), ([], [], None))


class DeviceTimeTest(unittest.TestCase):
    def test_parse(self) -> None:
        self.assertEqual(parse_device_time("18042026", "003014"), "2026-04-18T00:30:14")
        self.assertIsNone(parse_device_time("1804", "003014"))
        self.assertIsNone(parse_device_time("18042026", "xx"))


if __name__ == "__main__":
    unittest.main()
