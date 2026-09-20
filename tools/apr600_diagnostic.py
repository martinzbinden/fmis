#!/usr/bin/env python3
"""APR600-Diagnose: verbindet sich zum Ohrmarkenleser (TCP-Client, wie
AgriLink selbst) und protokolliert jede empfangene Byte-Sequenz sowie
erkannte [BEFEHL|...]-Frames mit Zeitstempel.

Reines Python-Standardbibliothek-Skript (kein pip install nötig) — auf
Windows reicht ein normaler Python-3-Interpreter (python.org, "Add to PATH"
beim Installer anhaken), dann:

    python apr600_diagnostic.py

Optional:
    python apr600_diagnostic.py --host 192.168.0.111 --port 2010 --probe

--probe sendet nach dem Verbinden testweise "[XGMEMINFO]" (ein aus dem
AgriLink-Programm selbst extrahierter Befehl, der die Anzahl gespeicherter
Datensätze abfragt) — bestätigt, ob unser rekonstruiertes Anfrage/Antwort-
Protokoll ([BEFEHL|...] -> [BEFEHL|OK|...] bzw. [BEFEHL|ERROR]) tatsächlich
passt. Kann weggelassen werden, wenn nur das unaufgeforderte Senden beim
Scannen einer Ohrmarke beobachtet werden soll.

Mit Strg+C beenden. Schreibt zusätzlich eine Logdatei
apr600_diagnostic_<Zeitstempel>.log ins aktuelle Verzeichnis — bitte diese
Datei zurückschicken, damit das Live-Lese-Format ausgewertet werden kann.
"""
import argparse
import datetime
import socket
import sys

DEFAULT_HOST = "192.168.0.111"
DEFAULT_PORT = 2010


def ts() -> str:
    return datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]


def hexdump(data: bytes) -> str:
    return " ".join(f"{b:02x}" for b in data)


def printable(data: bytes) -> str:
    return "".join(chr(b) if 32 <= b < 127 else "." for b in data)


class FrameSplitter:
    """Reproduziert die im AgriLink-Programm gefundene Framing-Logik:
    Frames beginnen bei '[', enden bei ']'; Zeichen < 32 (Steuerzeichen wie
    CR/LF) zwischen Frames werden ignoriert, keine feste Frame-Länge nötig."""

    def __init__(self, on_frame):
        self.buf = ""
        self.in_frame = False
        self.on_frame = on_frame

    def feed(self, data: bytes) -> None:
        for b in data:
            if b == 0x5B:  # '['
                self.buf = "["
                self.in_frame = True
            elif b == 0x5D:  # ']'
                if self.in_frame:
                    self.buf += "]"
                    self.on_frame(self.buf)
                self.buf = ""
                self.in_frame = False
            elif b >= 32 and self.in_frame:
                self.buf += chr(b)
            # Steuerzeichen (<32) ausserhalb eines Frames: ignorieren


def main() -> None:
    parser = argparse.ArgumentParser(description="APR600 TCP-Diagnose")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Standard: {DEFAULT_HOST}")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Standard: {DEFAULT_PORT}")
    parser.add_argument(
        "--probe",
        action="store_true",
        help="sendet nach dem Verbinden testweise [XGMEMINFO], um das Protokoll zu bestätigen",
    )
    args = parser.parse_args()

    logname = f"apr600_diagnostic_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    logfile = open(logname, "w", encoding="utf-8")

    def log(line: str) -> None:
        print(line)
        logfile.write(line + "\n")
        logfile.flush()

    def on_frame(frame: str) -> None:
        log(f"[{ts()}] FRAME: {frame}")

    splitter = FrameSplitter(on_frame)

    log(f"Verbinde zu {args.host}:{args.port} ...")
    try:
        sock = socket.create_connection((args.host, args.port), timeout=10)
    except OSError as e:
        log(f"Verbindung fehlgeschlagen: {e}")
        sys.exit(1)
    log("Verbunden. Jetzt ein paar Ohrmarken am Leser scannen. Strg+C zum Beenden.")

    if args.probe:
        probe_cmd = b"[XGMEMINFO]"
        log(f"[{ts()}] SENDE (Test): {probe_cmd!r}")
        sock.sendall(probe_cmd)

    try:
        while True:
            try:
                data = sock.recv(4096)
            except OSError as e:
                log(f"[{ts()}] Verbindung unterbrochen: {e}")
                break
            if not data:
                log(f"[{ts()}] Verbindung vom Gerät geschlossen.")
                break
            log(f"[{ts()}] RAW ({len(data)} Bytes) HEX:  {hexdump(data)}")
            log(f"[{ts()}] RAW TEXT: {printable(data)}")
            splitter.feed(data)
    except KeyboardInterrupt:
        log("Beendet durch Nutzer.")
    finally:
        sock.close()
        logfile.close()
        print(f"\nLog gespeichert unter: {logname}")


if __name__ == "__main__":
    main()
