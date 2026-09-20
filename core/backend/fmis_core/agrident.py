"""APR600 (Agrident) Ohrmarkenleser — async TCP-Client für das reverse-
engineerte Protokoll (siehe tools/apr600_diagnostic.py für die Herleitung
per .NET-IL-Analyse von AgriLink.exe, und die project_apr600_ear_tag_reader
Memory für die vollständige Dokumentation der Befunde).

Zwei unabhängige Framings auf derselben TCP-Verbindung:
- Befehl/Antwort: Anfrage `[BEFEHL|arg1|...]`, Antwort ist ein Echo-Opener
  `[BEFEHL]`, gefolgt von reinem (NICHT geklammertem) Text, gefolgt von
  `[BEFEHLOK]`/`[BEFEHLERROR]` — konkret bestätigt für XGMEMINFO:
  `[XGMEMINFO]448|1000000|113|10000|0|0[XGMEMINFOOK]`.
- Live-Read (unaufgefordert beim Scannen einer Ohrmarke): STX (0x02) +
  34 ASCII-Zeichen (bei Leser-EID-Format ISO24631) + CRLF (0x0d 0x0a),
  empirisch an mehreren realen Ohrmarken bestätigt (siehe tools/README.md).

Der Leser ist ein TCP-SERVER (fixe Farm-LAN-Adresse); wir verbinden als
Client. Es existiert nur EIN physisches Gerät — `acquire_reader()` sorgt
über ein Modul-weites Lock dafür, dass nie zwei Anfragen gleichzeitig
verbinden (z.B. eine laufende Melkliste UND ein Datenpool-Abruf).
"""

import asyncio
import re
import socket as socket_module
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

STX = 0x02
LIVE_READ_LEN = 34  # Payload-Länge bei EID-Format ISO24631
KEEPALIVE_INTERVAL = 20.0  # empirisch bestätigt: hält die Verbindung offen


class ReaderBusyError(Exception):
    """Ein anderer Request hält die (einzige) Verbindung zum Gerät."""


class ReaderError(Exception):
    """Verbindungsfehler, Zeitüberschreitung oder [BEFEHLERROR]-Antwort."""


def parse_live_read(payload: str) -> str | None:
    """Wandelt die 34-Zeichen-ASCII-Payload eines Live-Reads in die lange
    Ohrmarkenform ("CH" + 12-stellige nationale ID) um. None bei falscher
    Länge (kein gültiger Frame)."""
    if len(payload) != LIVE_READ_LEN:
        return None
    return "CH" + payload[10:22]


_SHEEP_LONG_TAG_RE = re.compile(r"^CH113(\d{8})\d$")


def sheep_short_tag(long_tag: str) -> str | None:
    """Wandelt die lange Ohrmarke (RFID-Chip-Format, z.B. "CH113200415115")
    in die kurze, offizielle TVD-Ohrmarke ("CH20041511") um.

    Empirisch hergeleitet, nicht aus einer Spezifikation: ein Abgleich aller
    67 Schafe mit sowohl SMG- als auch TVD-Tierbestandsdatensatz zeigt
    ausnahmslos lang = "CH113" + kurz[2:] + <1 Prüfziffer>. Gibt None zurück,
    wenn das Muster nicht passt (z.B. andere Tierart/anderer Betrieb) — kein
    Rateversuch, Aufrufer soll dann auf die lange Form zurückfallen."""
    m = _SHEEP_LONG_TAG_RE.match(long_tag)
    if not m:
        return None
    return "CH" + m.group(1)


class ReaderConnection:
    """Eine TCP-Verbindung zum APR600. Wird ausschliesslich über
    acquire_reader() erzeugt, nie direkt instanziert."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self._reader = reader
        self._writer = writer
        self._live_buf = bytearray()

    async def send_command(self, command: str, *args: str, timeout: float = 5.0) -> str:
        """Sendet [BEFEHL|arg1|...], wartet auf [BEFEHLOK]/[BEFEHLERROR] und
        gibt den reinen Text dazwischen zurück (roh, pipe-getrennt) — jeder
        Aufrufer parst das je nach Befehl selbst weiter, da jeder Befehl ein
        anderes Antwortformat hat.

        NICHT parallel zu live_reads() auf derselben Verbindung aufrufen —
        beide lesen von demselben Socket, ein gleichzeitiger Aufruf würde
        Frames verschränken. acquire_reader(..., keepalive=True) ist nur für
        den Live-Read-Anwendungsfall gedacht, der keine send_command()-Calls
        mehr macht, sobald live_reads() läuft."""
        parts = "|".join([command, *args])
        self._writer.write(f"[{parts}]".encode("ascii"))
        await self._writer.drain()

        opener = f"[{command}]"
        ok_closer = f"[{command}OK]"
        error_closer = f"[{command}ERROR]"
        buf = ""
        loop = asyncio.get_event_loop()
        deadline = loop.time() + timeout
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise ReaderError(f"Zeitüberschreitung bei Befehl {command}")
            try:
                data = await asyncio.wait_for(self._reader.read(4096), timeout=remaining)
            except asyncio.TimeoutError:
                raise ReaderError(f"Zeitüberschreitung bei Befehl {command}") from None
            if not data:
                raise ReaderError("Verbindung vom Leser geschlossen")
            buf += data.decode("ascii", errors="replace")
            if error_closer in buf:
                raise ReaderError(f"Leser meldet Fehler für {command}")
            if ok_closer in buf:
                start = buf.find(opener)
                payload_start = start + len(opener) if start != -1 else 0
                payload = buf[payload_start : buf.find(ok_closer)]
                return payload.strip("\r\n")

    async def live_reads(self) -> AsyncIterator[str]:
        """Liefert unaufgefordert eintreffende Live-Reads als lange Ohrmarke
        ("CH" + 12 Ziffern). Läuft bis die Verbindung geschlossen wird."""
        frame_len = 1 + LIVE_READ_LEN + 2  # STX + Payload + CRLF
        while True:
            data = await self._reader.read(4096)
            if not data:
                return
            self._live_buf.extend(data)
            while self._live_buf:
                if self._live_buf[0] != STX:
                    # Kein gültiger Frame-Start (z.B. Reste einer
                    # Keepalive-Befehlsantwort) — ein Byte verwerfen statt
                    # die Verbindung abzubrechen.
                    del self._live_buf[0]
                    continue
                if len(self._live_buf) < frame_len:
                    break
                frame = bytes(self._live_buf[:frame_len])
                del self._live_buf[:frame_len]
                payload = frame[1 : 1 + LIVE_READ_LEN].decode("ascii", errors="replace")
                tag = parse_live_read(payload)
                if tag:
                    yield tag

    def close(self) -> None:
        self._writer.close()


_lock = asyncio.Lock()


@asynccontextmanager
async def acquire_reader(host: str, port: int, *, keepalive: bool = False):
    """Exklusiver Zugriff auf das (einzige) physische Lesegerät — verbindet
    bei Eintritt, trennt zuverlässig bei Austritt. Wirft ReaderBusyError
    sofort (statt zu warten), wenn eine andere Sitzung die Verbindung schon
    hält — auf Anfrage/Antwort-Basis (Datenpool-Abruf) ist das ein kurzer
    Request, `keepalive=True` ist nur für die lang laufende Live-Melkliste
    gedacht (periodisches [XGMEMINFO], das absichtlich NICHT auf seine
    Antwort wartet, um live_reads()' Lesevorgang auf demselben Socket nicht
    zu stören — die Antwort wird dort einfach als Rauschen verworfen)."""
    if _lock.locked():
        raise ReaderBusyError("Lesegerät wird bereits von einer anderen Sitzung verwendet")
    async with _lock:
        reader, writer = await asyncio.open_connection(host, port)
        sock = writer.get_extra_info("socket")
        if sock is not None:
            sock.setsockopt(socket_module.SOL_SOCKET, socket_module.SO_KEEPALIVE, 1)
        conn = ReaderConnection(reader, writer)
        keepalive_task = asyncio.create_task(_keepalive_loop(writer)) if keepalive else None
        try:
            yield conn
        finally:
            if keepalive_task is not None:
                keepalive_task.cancel()
            conn.close()


async def _keepalive_loop(writer: asyncio.StreamWriter) -> None:
    while True:
        await asyncio.sleep(KEEPALIVE_INTERVAL)
        try:
            writer.write(b"[XGMEMINFO]")
            await writer.drain()
        except OSError:
            return
