"""Merkblätter: Dateityp am Inhalt, Links nur zu öffentlichen Adressen."""

import unittest

from fastapi import HTTPException

from modules.tiere.backend.app.documents import _check_url, _sniff


class DocumentsTest(unittest.TestCase):
    def test_sniff(self) -> None:
        self.assertEqual(_sniff(b"%PDF-1.6\r..."), "application/pdf")
        self.assertEqual(_sniff(b"\x89PNG\r\n"), "image/png")
        self.assertIsNone(_sniff(b"<!doctype html>"))

    def test_only_public_http(self) -> None:
        for url in ("ftp://example.org/a.pdf", "http://127.0.0.1/a.pdf", "http://192.168.0.73/a.pdf", "http://[::1]/a.pdf", "http://169.254.169.254/latest"):
            with self.assertRaises(HTTPException, msg=url):
                _check_url(url)


if __name__ == "__main__":
    unittest.main()
