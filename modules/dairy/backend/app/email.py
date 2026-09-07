import os
from email.message import EmailMessage

import aiosmtplib

SMTP_HOST = os.environ.get("SMTP_HOST", "localhost")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER") or None
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD") or None
SMTP_FROM = os.environ.get("SMTP_FROM", "dairy@localhost")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() != "false"


async def send_magic_link(to_email: str, link: str) -> None:
    message = EmailMessage()
    message["From"] = SMTP_FROM
    message["To"] = to_email
    message["Subject"] = "Dein Milchleistungs-Login-Link"
    message.set_content(
        "Hallo\n\n"
        "Mit diesem Link kannst du dich im Milchleistungs-Modul anmelden. Der Link "
        "bleibt bis zu 1 Jahr gültig und kann mehrfach verwendet werden — du kannst "
        "ihn z.B. als Lesezeichen speichern:\n\n"
        f"{link}\n\n"
        "Da der Link lange gültig ist: bitte nicht weiterleiten, er wirkt wie ein "
        "Passwort. Falls du diese E-Mail nicht angefordert hast, kannst du sie "
        "ignorieren."
    )

    await aiosmtplib.send(
        message,
        hostname=SMTP_HOST,
        port=SMTP_PORT,
        username=SMTP_USER,
        password=SMTP_PASSWORD,
        start_tls=SMTP_USE_TLS,
    )
