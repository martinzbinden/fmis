"""Gruppen vom Lesegerät: Signatur, Ablegen und Abgleich (ohne echtes Gerät)."""

import unittest
from contextlib import asynccontextmanager
from unittest import mock

from core.backend.fmis_core.agrident import ReaderBusyError
from modules.tiere.backend.app import reader_pools as rp


class SignatureTest(unittest.TestCase):
    def test_same_content_same_signature_regardless_of_order(self) -> None:
        a = rp.signature("Weide", 3, ["CH000900000101", "CH000900000102", "CH000900000103"])
        b = rp.signature("Weide", 3, ["CH000900000103", "CH000900000101", "CH000900000102"])
        self.assertEqual(a, b)

    def test_content_or_name_changes_signature(self) -> None:
        base = rp.signature("Weide", 2, ["CH000900000101", "CH000900000102"])
        self.assertNotEqual(base, rp.signature("Weide", 2, ["CH000900000101", "CH000900000199"]))
        self.assertNotEqual(base, rp.signature("Stall", 2, ["CH000900000101", "CH000900000102"]))
        self.assertNotEqual(base, rp.signature("Weide", 3, ["CH000900000101", "CH000900000102"]))


class FakeConn:
    """Gerät: XGGROUPS liefert die Liste, XGMEM <id> die Ohrmarken."""

    def __init__(self, groups: str, members: dict[str, str]) -> None:
        self.groups, self.members, self.calls = groups, members, []

    async def send_command(self, command: str, *args: str, timeout: float = 5.0) -> str:
        self.calls.append((command, *args))
        return self.groups if command == "XGGROUPS" else self.members[args[0]]


def fake_reader(conn: FakeConn):
    @asynccontextmanager
    async def acquire(host: str, port: int, *, keepalive: bool = False):
        yield conn

    return acquire


class ReadDeviceTest(unittest.IsolatedAsyncioTestCase):
    async def test_fetches_only_unknown_groups(self) -> None:
        conn = FakeConn("1|Weide|2\r\n2|Stall|1\r\n", {"1": "CH000900000101|1\r\nCH000900000102|1\r\n", "2": "CH000900000103|1\r\n"})
        with mock.patch.object(rp, "acquire_reader", fake_reader(conn)):
            found = await rp.read_device("h", 1, known={("2", "Stall|1")})
        self.assertEqual([g["group_id"] for g in found], ["1"])
        self.assertEqual(found[0]["tags"], ["CH000900000101", "CH000900000102"])
        self.assertEqual(conn.calls, [("XGGROUPS",), ("XGMEM", "1")])

    async def test_unparsable_lines_kept_apart(self) -> None:
        conn = FakeConn("1|X|2\r\n", {"1": "CH000900000101|1\r\nkaputt\r\n"})
        with mock.patch.object(rp, "acquire_reader", fake_reader(conn)):
            found = await rp.read_device("h", 1, known=set())
        self.assertEqual(found[0]["tags"], ["CH000900000101"])
        self.assertEqual(found[0]["unmatched"], ["kaputt"])

    async def test_busy_reader_is_reported_not_raised(self) -> None:
        @asynccontextmanager
        async def busy(host: str, port: int, *, keepalive: bool = False):
            raise ReaderBusyError("belegt")
            yield  # pragma: no cover

        async def resolve(module: str):
            return ("tiere", "h", 1)

        class NoDb:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def execute(self, *a, **k):
                class R:
                    async def fetchall(self_inner):
                        return []

                return R()

        with (
            mock.patch.object(rp, "acquire_reader", busy),
            mock.patch.object(rp, "resolve_reader", resolve),
            mock.patch.object(rp.pool, "connection", lambda: NoDb()),
        ):
            result = await rp.refresh()
        self.assertFalse(result["ok"])
        self.assertEqual(result["new"], 0)
        self.assertEqual(rp.state["last_error"], "belegt")


if __name__ == "__main__":
    unittest.main()
