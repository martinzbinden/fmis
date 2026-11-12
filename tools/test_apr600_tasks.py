"""Tests für tools/apr600_tasks.py (Aufgaben-Projektdatei für AgriLink)."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import apr600_tasks as t  # noqa: E402


class AblammungTest(unittest.TestCase):
    def test_passes_the_checks(self) -> None:
        self.assertEqual(t.check_task(t.ablammung()), [])

    def test_shape(self) -> None:
        task = t.ablammung()
        self.assertEqual([f.name for f in task.fields], ["Mutter", "Lamm 1", "Lamm 2", "Lamm 3", "Lamm 4"])
        self.assertEqual(task.fields[0].typ, t.T_EIC)
        self.assertTrue(all(f.typ == t.T_SELECTION and f.rec_eic == 0 for f in task.fields[1:]))
        # Lamm 1 hat immer ein Ergebnis, die weiteren dürfen fehlen
        self.assertNotIn("-", [o.value for o in task.fields[1].options])
        self.assertIn("-", [o.value for o in task.fields[2].options])


class TraechtigkeitTest(unittest.TestCase):
    def test_passes_the_checks_and_matches_fmis_values(self) -> None:
        task = t.traechtigkeit()
        self.assertEqual(t.check_task(task), [])
        self.assertEqual([f.name for f in task.fields], ["Tier", "Ergebnis"])
        # pregnancy_checks.result in FMIS: ja | nein | unsicher
        self.assertEqual([o.value for o in task.fields[1].options], ["ja", "nein", "unsicher"])

    def test_both_tasks_in_one_project(self) -> None:
        text = t.render_project([t.ablammung(), t.traechtigkeit()])
        self.assertIn("[Task.1.Definition]", text)
        self.assertIn("[Task.2.Definition]", text)
        self.assertEqual([x.name for x in t.parse_project(text)], ["Ablammung", "Traechtigkeit"])


class GruppenwechselTest(unittest.TestCase):
    def test_options_are_groups_plus_new_and_none(self) -> None:
        task = t.gruppenwechsel(["Weide Nord", "Stall"])
        self.assertEqual(t.check_task(task), [])
        self.assertEqual([o.text for o in task.fields[1].options], ["Weide Nord", "Stall", "NEUE GRUPPE", "ohne Gruppe"])
        self.assertEqual(task.fields[0].typ, t.T_EIC)

    def test_device_text_is_ascii_without_commas(self) -> None:
        self.assertEqual(t.device_text("Mutterschafe, Müesli  Äste"), "Mutterschafe Mueesli Aeste")
        self.assertEqual(t.device_text("Gruppe ñ"), "Gruppe ?")

    def test_umlauts_and_duplicates_are_cleaned(self) -> None:
        task = t.gruppenwechsel(["Lämmer", "Laemmer", "Böcke"])
        self.assertEqual([o.text for o in task.fields[1].options][:2], ["Laemmer", "Boecke"])

    def test_at_most_16_options(self) -> None:
        task = t.gruppenwechsel([f"G{i}" for i in range(15)])  # 15 + 2 feste = 17
        self.assertTrue(any("Optionen" in p for p in t.check_task(task)))

    def test_cli_needs_groups(self) -> None:
        with self.assertRaises(SystemExit):
            t.main(["gruppenwechsel", "-o", os.devnull])


class RenderTest(unittest.TestCase):
    def test_exact_keys(self) -> None:
        text = t.render_project([t.ablammung()])
        lines = text.splitlines()
        self.assertEqual(lines[:3], ["[Project]", "FileType=20562", "FileVersion=1"])
        self.assertIn("[Task.1.Definition]", lines)
        self.assertIn("Fields=5", lines)
        self.assertIn("Field0=Mutter,7,15,0,0,0,0,1,0,13,13,0", lines)
        self.assertIn("Field1=Lamm 1,1,10,0,0,0,3,1,0,13,13,0", lines)
        self.assertIn("Option1.0=Aue (w),w", lines)
        self.assertIn("Option2.0=kein Lamm,-", lines)
        self.assertIn("FieldsDownload=0,1,2,3,4", lines)

    def test_round_trip(self) -> None:
        back = t.parse_project(t.render_project([t.ablammung()]))
        self.assertEqual(back, [t.ablammung()])

    def test_file_is_windows_ansi_with_crlf(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "a.apr")
            t.write_project([t.ablammung()], path)
            raw = open(path, "rb").read()
        self.assertIn(b"\r\n", raw)
        self.assertNotIn(b"\n\n", raw.replace(b"\r\n", b""))
        raw.decode("ascii")  # nur ASCII: Anzeige am Gerät


class CheckTest(unittest.TestCase):
    def task(self, *fields: t.Field) -> t.Task:
        return t.Task("X", "", list(fields))

    def test_needs_a_tag_reading_field(self) -> None:
        problems = t.check_task(self.task(t.Field("Zahl", t.T_NUMERIC)))
        self.assertTrue(any("Ohrmarke" in p for p in problems))

    def test_reference_must_exist_come_before_and_read_a_tag(self) -> None:
        eic = t.Field("Mutter", t.T_EIC)
        self.assertTrue(any("nicht gibt" in p for p in t.check_task(self.task(eic, t.Field("A", t.T_NUMERIC, rec_eic=5)))))
        self.assertTrue(any("keine Ohrmarke" in p for p in t.check_task(self.task(eic, t.Field("A", t.T_NUMERIC, rec_eic=1)))))
        self.assertTrue(any("danach" in p for p in t.check_task(self.task(t.Field("A", t.T_NUMERIC, rec_eic=1), eic))))

    def test_limits(self) -> None:
        many = [t.Field("Mutter", t.T_EIC)] + [t.Field(f"F{i}", t.T_NUMERIC) for i in range(40)]
        self.assertTrue(any("Felder" in p for p in t.check_task(self.task(*many))))
        opts = [t.Option(str(i), str(i)) for i in range(17)]
        self.assertTrue(any("Optionen" in p for p in t.check_task(self.task(t.Field("Mutter", t.T_EIC), t.Field("A", t.T_SELECTION, options=opts)))))
        self.assertTrue(any("ohne Optionen" in p for p in t.check_task(self.task(t.Field("Mutter", t.T_EIC), t.Field("A", t.T_SELECTION)))))

    def test_text_rules(self) -> None:
        bad = t.Field("Mutter", t.T_EIC), t.Field("Lämmer, viele", t.T_NUMERIC)
        self.assertTrue(any("ASCII" in p for p in t.check_task(self.task(*bad))))
        # Beschreibungen dürfen Kommas haben, Namen nicht
        ok = t.Field("Mutter", t.T_EIC), t.Field("Zahl", t.T_NUMERIC, description="eins, zwei")
        self.assertEqual(t.check_task(self.task(*ok)), [])

    def test_too_many_tasks(self) -> None:
        with self.assertRaises(ValueError):
            t.render_project([t.ablammung()] * 10)

    def test_invalid_task_is_not_rendered(self) -> None:
        with self.assertRaises(ValueError):
            t.render_project([t.Task("X", "", [])])


if __name__ == "__main__":
    unittest.main()
