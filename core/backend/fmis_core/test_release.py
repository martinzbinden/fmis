"""Freigabe-Briefkasten und Mail-Riegel der Testumgebung (release.py, email.py)."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from core.backend.fmis_core import email as mail
from core.backend.fmis_core import release
from core.backend.fmis_core.auth import CurrentUser

DEV = "a" * 40
PROD = "b" * 40
ADMIN = CurrentUser(id="u1", email="admin@example.org", role="admin", permissions={"core:users:manage"})


class ReleaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.box = Path(self.tmp.name)
        self.old = (release.BOX, release.INSTANZ)
        release.BOX, release.INSTANZ = self.box, "dev"
        (self.box / "stand.json").write_text(json.dumps({"dev_sha": DEV, "prod_sha": PROD, "commits": []}))

    def tearDown(self) -> None:
        release.BOX, release.INSTANZ = self.old
        self.tmp.cleanup()

    def request(self, sha: str) -> dict:
        return asyncio.run(release.request_release(release.ReleaseBody(sha=sha), ADMIN))

    def test_writes_request_for_running_commit(self) -> None:
        out = self.request(DEV)
        saved = json.loads((self.box / "angefordert.json").read_text())
        self.assertEqual(saved["sha"], DEV)
        self.assertEqual(saved["von"], "admin@example.org")
        self.assertEqual(out["sha"], DEV)

    def test_rejects_other_commit(self) -> None:
        with self.assertRaises(HTTPException) as e:
            self.request("c" * 40)
        self.assertEqual(e.exception.status_code, 409)
        self.assertFalse((self.box / "angefordert.json").exists())

    def test_rejects_commit_already_on_prod(self) -> None:
        (self.box / "stand.json").write_text(json.dumps({"dev_sha": DEV, "prod_sha": DEV}))
        with self.assertRaises(HTTPException):
            self.request(DEV)

    def test_prod_has_no_release_and_no_datenstand(self) -> None:
        release.INSTANZ = None
        (self.box / "datenstand.txt").write_text("2026-11-10T09:00:00+01:00 abc1234")
        with self.assertRaises(HTTPException) as e:
            self.request(DEV)
        self.assertEqual(e.exception.status_code, 404)
        self.assertIsNone(release.datenstand())

    def test_datenstand_on_dev(self) -> None:
        (self.box / "datenstand.txt").write_text("2026-11-10T09:00:00+01:00 abc1234\n")
        self.assertEqual(release.datenstand(), "2026-11-10T09:00:00+01:00 abc1234")


class MailAllowlistTest(unittest.TestCase):
    def setUp(self) -> None:
        self.old = mail.MAIL_ALLOWLIST

    def tearDown(self) -> None:
        mail.MAIL_ALLOWLIST = self.old

    def test_empty_allows_all(self) -> None:
        mail.MAIL_ALLOWLIST = set()
        self.assertTrue(mail.mail_allowed("someone@example.org"))

    def test_only_listed(self) -> None:
        mail.MAIL_ALLOWLIST = {"test1@example.org"}
        self.assertTrue(mail.mail_allowed(" Test1@example.org "))
        self.assertFalse(mail.mail_allowed("someone@example.org"))


if __name__ == "__main__":
    unittest.main()
