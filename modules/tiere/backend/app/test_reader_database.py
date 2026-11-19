"""Tierinfos als Datenbank aufs Lesegerät: Prüfung, Ersetzen mit Sicherung, Rückfall (ohne echtes Gerät)."""

import asyncio
import re
import unittest

from core.backend.fmis_core.agrident import ReaderError, acquire_reader
from modules.tiere.backend.app import reader_database as rd

FIELDS = [rd.Field(title="VID", width=20, type=9), rd.Field(title="Gruppe", width=20), rd.Field(title="Ablammung", width=20)]
R1 = rd.Row(iso="756000019678802", values=["101 (8802) 245d 1L", "Weide", "12.03.26 (245 T)"])
R2 = rd.Row(iso="756000019678787", values=["102 (8787) trocken", "", ""])


class FakeDevice:
    """Datenbank des Geräts: XEDATASETS leert, XIDB/XIDBFIELD legen Felder an, XADATASET|<hex>|1|v|2|w fügt hinzu,
    XGDATASET|n liest Datensatz n. `drop_after` lässt ab dem n-ten Datensatz alle verschwinden (Fehlerfall)."""

    def __init__(self, fields: list[rd.Field] | None = None, rows: dict[str, list[str]] | None = None, drop_after: int | None = None) -> None:
        self.fields = list(fields or [])
        self.rows = dict(rows or {})  # Ohrmarke 16 Ziffern → Werte
        self.drop_after = drop_after
        self.added = 0
        self.calls: list[str] = []

    async def send_command(self, command: str, *args: str, timeout: float = 5.0, encoding: str = "ascii") -> str:
        self.calls.append(command)
        if command == "XEDATASETS":
            self.rows.clear()
            return ""
        if command == "XIDB":
            self.fields = []
            self.declared = int(args[0])
            return ""
        if command == "XIDBFIELD":
            self.fields.append(rd.Field(title=args[1], width=int(args[2]), flag=int(args[3]), type=int(args[4])))
            return ""
        if command == "XADATASET":
            iso_hex = args[0]
            n = int(iso_hex, 16)
            eid = f"{n >> 38:04d}{n & ((1 << 38) - 1):012d}"
            values = [""] * len(self.fields)
            for i in range(1, len(args) - 1, 2):
                values[int(args[i]) - 1] = args[i + 1]
            if values[0].startswith("10"):  # nur die neuen Tiere des Tests (VID 101, 102 …) können verloren gehen
                self.added += 1
                if self.drop_after is not None and self.added > self.drop_after:
                    return ""
            self.rows[eid] = values
            return ""
        if command == "XGDBSTAT":
            return f"[XGDBSTAT]{len(self.fields)}|{len(self.fields)}|{len(self.rows)}|20000"
        if command == "XGDBFIELD":
            return "".join(f"[{i}|{f.title}|{f.width}|{f.flag}|{f.type}|0]\r\n" for i, f in enumerate(self.fields, start=1))
        if command == "XGDATASET":
            items = list(self.rows.items())
            n = int(args[0])
            if n > len(items):
                return f"[XGDATASET|{n}]"
            eid, vals = items[n - 1]
            return f"[XGDATASET|{n}][{eid}|" + "|".join(vals) + "]\r\n"
        raise AssertionError(command)


class HelpersTest(unittest.TestCase):
    def test_empty_values_are_left_out_of_xadataset(self) -> None:
        self.assertEqual(rd.xadataset_args("0000BD00012C4652", ["101", "", "x"]), ["0000BD00012C4652", "1", "101", "3", "x"])

    def test_parse_record_and_missing_record(self) -> None:
        self.assertEqual(rd.parse_record("[XGDATASET|1][0999000000000001|T-101|test|0|x|||]\r\n"), ("0999000000000001", ["T-101", "test", "0", "x", "", "", ""]))
        self.assertIsNone(rd.parse_record("[XGDATASET|9]"))

    def test_parse_fields(self) -> None:
        raw = "[XGDBFIELD][1|VID|10|0|9|0]\r\n[2|Alert|2|1|21|0]\r\n"
        self.assertEqual([(f.title, f.width, f.flag, f.type) for f in rd.parse_fields(raw)], [("VID", 10, 0, 9), ("Alert", 2, 1, 21)])


class ValidateTest(unittest.TestCase):
    def test_accepts_good_input(self) -> None:
        rd.validate(FIELDS, [R1, R2])

    def test_refuses_bad_input(self) -> None:
        wrong_count = rd.Row(iso="756000019678802", values=["a"])
        long_value = rd.Row(iso="756000019678802", values=["x" * 21, "", ""])
        bad_char = rd.Row(iso="756000019678802", values=["a|b", "", ""])
        no_vid = rd.Row(iso="756000019678802", values=["", "g", ""])
        for fields, rows in (
            ([], [R1]),
            ([rd.Field(title="Gruppe", width=20)], [R1]),  # Feld 1 ist keine VID
            (FIELDS, []),
            (FIELDS, [R1, R1]),
            (FIELDS, [wrong_count]),
            (FIELDS, [long_value]),
            (FIELDS, [bad_char]),
            (FIELDS, [no_vid]),
            ([rd.Field(title="VID", width=20, type=9), rd.Field(title="x" * 21, width=5)], [rd.Row(iso="756000019678802", values=["a", "b"])]),
            ([rd.Field(title="VID", width=20, type=7)], [rd.Row(iso="756000019678802", values=["a"])]),
        ):
            with self.assertRaises(ValueError, msg=str((fields, rows))):
                rd.validate(fields, rows)


class ReplaceTest(unittest.IsolatedAsyncioTestCase):
    async def test_replaces_and_verifies_every_record(self) -> None:
        old_fields = [rd.Field(title="VID", width=10, type=9), rd.Field(title="Alt", width=20)]
        dev = FakeDevice(old_fields, {"0756000019678790": ["1903", "alt"]})
        out = await rd.replace_database(dev, FIELDS, [R1, R2])
        self.assertEqual((out["sent"], out["verified"], out["fields"], out["backup_rows"], out["backup_fields"]), (2, 2, 3, 1, 2))
        self.assertIn("1903|alt", out["backup"])
        self.assertEqual([f.title for f in dev.fields], ["VID", "Gruppe", "Ablammung"])
        self.assertEqual(dev.rows["0756000019678787"], ["102 (8787) trocken", "", ""])

    async def test_a_lost_record_restores_the_old_database(self) -> None:
        old_fields = [rd.Field(title="VID", width=10, type=9), rd.Field(title="Alt", width=20)]
        old_rows = {"0756000019678790": ["1903", "alt"]}
        dev = FakeDevice(old_fields, old_rows, drop_after=1)
        with self.assertRaises(ReaderError) as ctx:
            await rd.replace_database(dev, FIELDS, [R1, R2])
        self.assertIn("wieder aufgespielt", str(ctx.exception))
        self.assertEqual([f.title for f in dev.fields], ["VID", "Alt"])
        self.assertEqual(dev.rows, old_rows)

    async def test_works_without_an_old_database(self) -> None:
        dev = FakeDevice()
        out = await rd.replace_database(dev, FIELDS, [R1])
        self.assertEqual((out["sent"], out["verified"], out["backup_rows"]), (1, 1, 0))

    async def test_invalid_input_touches_nothing(self) -> None:
        dev = FakeDevice()
        with self.assertRaises(ValueError):
            await rd.replace_database(dev, [], [R1])
        self.assertEqual(dev.calls, [])


class OverTcpTest(unittest.IsolatedAsyncioTestCase):
    """Echtes TCP gegen einen kleinen Nachbau: Befehle mit Latin-1, Antworten mit [BEFEHLOK]."""

    async def asyncSetUp(self) -> None:
        self.dev = FakeDevice()
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self) -> None:
        self.server.close()
        await self.server.wait_closed()

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        buf = b""
        try:
            while data := await reader.read(4096):
                buf += data
                while m := re.match(rb"\[([^\]]*)\]", buf):
                    buf = buf[m.end():]
                    command, *args = m.group(1).decode("latin-1").split("|")
                    body = await self.dev.send_command(command, *args)
                    writer.write(f"[{m.group(1).decode('latin-1')}]".encode("latin-1") + body.encode("latin-1") + f"[{command}OK]\r\n".encode("latin-1"))
                    await writer.drain()
        except ConnectionError:
            pass
        finally:
            writer.close()

    async def test_replace_over_tcp_with_umlaut_title(self) -> None:
        fields = [rd.Field(title="VID", width=20, type=9), rd.Field(title="Gr\xfcppe", width=20)]
        async with acquire_reader("127.0.0.1", self.port) as conn:
            out = await rd.replace_database(conn, fields, [rd.Row(iso="756000019678802", values=["101", "W\xe4ide"])])
        self.assertEqual((out["sent"], out["verified"]), (1, 1))
        self.assertEqual(self.dev.rows["0756000019678802"], ["101", "W\xe4ide"])


if __name__ == "__main__":
    unittest.main()
