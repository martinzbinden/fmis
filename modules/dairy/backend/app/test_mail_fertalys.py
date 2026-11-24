import datetime as dt
import email
import email.policy

from core.backend.fmis_core.mailbox import body_text, sender_allowed
from modules.dairy.backend.app.mail_fertalys import parse_fertalys, parse_mail_date

# erfundene Namen, Aufbau wie die Mail von cownect/Qualitas
TEXT = """Sehr geehrte Damen und Herren,
Sie erhalten Ihre neuen FERTALYS Resultate. Wir danken Ihnen für den Auftrag.

TESTA Trächtig
PROBINA Nicht trächtig
> MUSTER ROSA Fraglich

Vielen Dank und freundliche Grüsse"""


def test_zeilen():
    assert parse_fertalys(TEXT) == [
        {"name": "TESTA", "result": "ja", "text": "Trächtig"},
        {"name": "PROBINA", "result": "nein", "text": "Nicht trächtig"},
        {"name": "MUSTER ROSA", "result": "unsicher", "text": "Fraglich"},
    ]


def test_datum():
    today = dt.date(2026, 11, 24)
    assert parse_mail_date("Mi., 26. Aug., 16:20", today) == dt.date(2026, 8, 26)
    assert parse_mail_date("Mi., 26. Dez., 16:20", today) == dt.date(2025, 12, 26)
    assert parse_mail_date("Datum: 03.09.2026", today) == dt.date(2026, 9, 3)
    assert parse_mail_date("ohne", today) is None


def test_absender():
    allowed = ["cownect@example.ch", "@example.org"]
    assert sender_allowed("Cownect@Example.ch", allowed)
    assert sender_allowed("jemand@example.org", allowed)
    assert not sender_allowed("jemand@example.ch", allowed)


def test_weitergeleitet_html():
    raw = (
        "From: jemand@example.org\nSubject: Fwd: FERTALYS\nMIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n"
        "<p>---------- Forwarded message ---------<br>Datum: Mi., 26. Aug. 2026</p><p>TESTA Tr&auml;chtig<br>PROBINA Nicht tr&auml;chtig</p>"
    )
    msg = email.message_from_string(raw, policy=email.policy.default)
    text = body_text(msg)
    assert [x["name"] for x in parse_fertalys(text)] == ["TESTA", "PROBINA"]
    assert parse_mail_date(text, dt.date(2026, 11, 24)) == dt.date(2026, 8, 26)
