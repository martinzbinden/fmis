"""Link-Liste aufs Lesegerät: Umrechnung, Prüfung, Ersetzen mit Sicherung und Zurückspielen (ohne echtes Gerät)."""

import asyncio
import re
import unittest

from core.backend.fmis_core.agrident import ReaderError, acquire_reader
from modules.tiere.backend.app import reader_lists as rl


class FakeDevice:
    """Link-Liste des Geräts: XETAGLIST löscht, rohe Zeilen `[E<hex>|VID|n]` fügen hinzu, XGTAGLIST liefert sie als
    E + 4-stelliger Landescode + 12-stellige Nummer. `drop_line` lässt eine Zeile verschwinden (Fehlerfall)."""

    def __init__(self, items: dict[str, tuple[str, int]] | None = None, drop_line: int | None = None) -> None:
        self.items = dict(items or {})
        self.drop_line = drop_line
        self.sent = 0
        self.calls: list[str] = []

    async def send_command(self, command: str, *args: str, timeout: float = 5.0, encoding: str = "ascii") -> str:
        self.calls.append(command)
        if command == "XETAGLIST":
            self.items.clear()
            return ""
        assert command == "XGTAGLIST"
        return "\r\n" + "".join(f"[E{k}|{v}|{a}]\r\n" if a else f"[E{k}|{v}]\r\n" for k, (v, a) in self.items.items())

    async def send_line(self, line: str, *, timeout: float = 1.0) -> bool:
        self.sent += 1
        if self.drop_line is not None and self.sent == self.drop_line:
            return False
        hex_part, vid, alert = line[2:].rstrip("]").split("|")
        n = int(hex_part, 16)
        country, nid = n >> 38, n & ((1 << 38) - 1)
        self.items[f"{country:04d}{nid:012d}"] = (vid, int(alert))
        return True


E1 = rl.Entry(iso="756000019678802", vid="101 (8802) 245d 1L")
E2 = rl.Entry(iso="756000019678787", vid="102 (8787) trocken")


class ConversionTest(unittest.TestCase):
    def test_hex_matches_the_value_the_device_accepted(self) -> None:
        # am echten Gerät bestätigt: diese Hex-Zahl erscheint dort wieder als E0756000019678802
        self.assertEqual(rl.hex_eid("756000019678802"), "0000BD00012C4652")
        self.assertEqual(rl.hex_eid("999000000000001"), "0000F9C000000001")
        self.assertEqual(rl.device_eid("756000019678802"), "0756000019678802")
        self.assertEqual(rl.hex_from_device("0756000019678802"), "0000BD00012C4652")

    def test_bad_iso_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            rl.hex_eid("75600001967880")


class ValidateTest(unittest.TestCase):
    def test_accepts_good_entries(self) -> None:
        rl.validate([E1, E2])

    def test_refuses_empty_duplicate_long_and_bad_characters(self) -> None:
        for bad in ([], [E1, E1], [rl.Entry(iso="756000019678802", vid="x" * 21)], [rl.Entry(iso="756000019678802", vid="a|b")], [rl.Entry(iso="756000019678802", vid="a]b")], [rl.Entry(iso="756000019678802", vid="a€")], [rl.Entry(iso="756000019678802", vid="a", alert=251)]):
            with self.assertRaises(ValueError, msg=str(bad)):
                rl.validate(bad)

    def test_latin1_umlauts_are_allowed(self) -> None:
        rl.validate([rl.Entry(iso="756000019678802", vid="2212 BLÜMLISALP")])


class ParseTest(unittest.TestCase):
    def test_parse_device_list_with_and_without_alert(self) -> None:
        raw = "[E0756000019678802|1908]\r\n[E0756000019678787|1901|3]\r\nnoise"
        self.assertEqual(rl.parse_device_list(raw), {"0756000019678802": ("1908", 0), "0756000019678787": ("1901", 3)})


class ReplaceTest(unittest.IsolatedAsyncioTestCase):
    async def test_replaces_backs_up_and_verifies(self) -> None:
        dev = FakeDevice({"0756000019678802": ("1908", 0), "0756000019678790": ("1903", 0)})
        out = await rl.replace_link_list(dev, [E1, E2])
        self.assertEqual((out["sent"], out["verified"], out["backup_entries"]), (2, 2, 2))
        self.assertIn("1908", out["backup"])  # die alte Liste ist gesichert
        self.assertEqual(dev.items, {"0756000019678802": ("101 (8802) 245d 1L", 0), "0756000019678787": ("102 (8787) trocken", 0)})

    async def test_mismatch_restores_the_old_list(self) -> None:
        old = {"0756000019678802": ("1908", 0), "0756000019678790": ("1903", 0)}
        dev = FakeDevice(old, drop_line=2)  # die zweite gesendete Zeile geht verloren
        with self.assertRaises(ReaderError) as ctx:
            await rl.replace_link_list(dev, [E1, E2])
        self.assertIn("wieder aufgespielt", str(ctx.exception))
        self.assertEqual(dev.items, old)

    async def test_invalid_entries_touch_nothing(self) -> None:
        dev = FakeDevice({"0756000019678802": ("1908", 0)})
        with self.assertRaises(ValueError):
            await rl.replace_link_list(dev, [rl.Entry(iso="x", vid="a")])
        self.assertEqual(dev.calls, [])



class OverTcpTest(unittest.IsolatedAsyncioTestCase):
    """Gegen einen kleinen Nachbau des Geräts über echtes TCP: Echo der Zeilen, Antworten mit [BEFEHLOK]."""

    async def asyncSetUp(self) -> None:
        self.items: dict[str, tuple[str, int]] = {"0756000019678802": ("1908", 0), "0756000020533149": ("2212 BL\xdcMLISALP", 0)}
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
                while (m := re.match(rb"\[([^\]]*)\]", buf)):
                    text = m.group(0)
                    buf = buf[m.end():]
                    body = m.group(1).decode("latin-1")
                    if body == "XETAGLIST":
                        self.items.clear()
                        writer.write(b"[XETAGLIST][XETAGLISTOK]\r\n")
                    elif body == "XGTAGLIST":
                        rows = "".join(f"[E{k}|{v}]\r\n" if not a else f"[E{k}|{v}|{a}]\r\n" for k, (v, a) in self.items.items())
                        writer.write(b"[XGTAGLIST]\r\n" + rows.encode("latin-1") + b"[XGTAGLISTOK]\r\n")
                    elif body.startswith("E"):
                        hex_part, vid, alert = body[1:].split("|")
                        n = int(hex_part, 16)
                        self.items[f"{n >> 38:04d}{n & ((1 << 38) - 1):012d}"] = (vid, int(alert))
                        writer.write(text)  # Echo
                    await writer.drain()
        except ConnectionError:
            pass
        finally:
            writer.close()  # sonst wartet wait_closed() ewig auf diese Verbindung

    async def test_replace_over_tcp_keeps_umlauts_in_the_backup(self) -> None:
        async with acquire_reader("127.0.0.1", self.port) as conn:
            out = await rl.replace_link_list(conn, [E1, E2])
        self.assertEqual((out["sent"], out["verified"], out["backup_entries"]), (2, 2, 2))
        self.assertIn("2212 BL\xdcMLISALP", out["backup"])
        self.assertEqual(self.items, {"0756000019678802": ("101 (8802) 245d 1L", 0), "0756000019678787": ("102 (8787) trocken", 0)})


if __name__ == "__main__":
    unittest.main()
