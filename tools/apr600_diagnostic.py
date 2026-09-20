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

--keepalive-interval SEKUNDEN (Standard 20, 0 = aus) schickt periodisch
[XGMEMINFO] als Herzschlag — falls die Verbindung nach ein paar Sekunden
Inaktivität abzureissen scheint, testet das, ob ein einfacher periodischer
Befehl das verhindert. Zusätzlich ist TCP-Keepalive (SO_KEEPALIVE) auf dem
Socket aktiv. Wenn stattdessen NICHT der Socket abreisst, sondern das Gerät
einfach keine neuen Tag-Lesungen mehr sendet (Socket bleibt offen, aber
"WARTE..."-Zeilen erscheinen ohne neue RAW-Zeilen dazwischen), deutet das
eher auf einen Ruhezustand der Antenne/RF-Feld hin als auf ein TCP-Problem
— dann brauchen wir vermutlich einen eigenen Befehl, der das Gerät ins
aktive Scannen versetzt (noch nicht identifiziert).

Mit Strg+C beenden. Schreibt zusätzlich eine Logdatei
apr600_diagnostic_<Zeitstempel>.log ins aktuelle Verzeichnis — bitte diese
Datei zurückschicken, damit das Live-Lese-Format ausgewertet werden kann.
"""
import argparse
import datetime
import socket
import sys
import threading

DEFAULT_HOST = "192.168.0.111"
DEFAULT_PORT = 2010
DEFAULT_KEEPALIVE_INTERVAL = 20
RECV_TIMEOUT = 5.0


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


def enable_tcp_keepalive(sock: socket.socket) -> None:
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    # Feinere Keepalive-Parameter sind plattformabhängig (Linux: TCP_KEEPIDLE/
    # TCP_KEEPINTVL/TCP_KEEPCNT, Windows: nicht direkt über socket-Modul
    # einstellbar) — SO_KEEPALIVE allein reicht als erster Test.
    for opt_name in ("TCP_KEEPIDLE", "TCP_KEEPINTVL", "TCP_KEEPCNT"):
        opt = getattr(socket, opt_name, None)
        if opt is not None:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, opt, 5 if opt_name != "TCP_KEEPCNT" else 3)
            except OSError:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(description="APR600 TCP-Diagnose")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Standard: {DEFAULT_HOST}")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Standard: {DEFAULT_PORT}")
    parser.add_argument(
        "--probe",
        action="store_true",
        help="sendet nach dem Verbinden testweise [XGMEMINFO], um das Protokoll zu bestätigen",
    )
    parser.add_argument(
        "--keepalive-interval",
        type=float,
        default=DEFAULT_KEEPALIVE_INTERVAL,
        help=f"periodisch [XGMEMINFO] senden, alle N Sekunden (Standard {DEFAULT_KEEPALIVE_INTERVAL}, 0 = aus)",
    )
    args = parser.parse_args()

    logname = f"apr600_diagnostic_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    logfile = open(logname, "w", encoding="utf-8")
    log_lock = threading.Lock()

    def log(line: str) -> None:
        with log_lock:
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
    enable_tcp_keepalive(sock)
    sock.settimeout(RECV_TIMEOUT)
    log("Verbunden. Jetzt ein paar verschiedene Ohrmarken am Leser scannen. Strg+C zum Beenden.")

    if args.probe:
        probe_cmd = b"[XGMEMINFO]"
        log(f"[{ts()}] SENDE (Test): {probe_cmd!r}")
        sock.sendall(probe_cmd)

    stop_event = threading.Event()

    def keepalive_loop() -> None:
        while not stop_event.wait(args.keepalive_interval):
            try:
                sock.sendall(b"[XGMEMINFO]")
                log(f"[{ts()}] SENDE (Keepalive): b'[XGMEMINFO]'")
            except OSError as e:
                log(f"[{ts()}] Keepalive-Senden fehlgeschlagen: {e}")
                return

    keepalive_thread = None
    if args.keepalive_interval > 0:
        keepalive_thread = threading.Thread(target=keepalive_loop, daemon=True)
        keepalive_thread.start()

    idle_seconds = 0.0
    try:
        while True:
            try:
                data = sock.recv(4096)
            except socket.timeout:
                idle_seconds += RECV_TIMEOUT
                log(f"[{ts()}] WARTE... {idle_seconds:.0f}s ohne Daten, Socket noch offen.")
                continue
            except OSError as e:
                log(f"[{ts()}] Verbindung unterbrochen: {e}")
                break
            if not data:
                log(f"[{ts()}] Verbindung vom Gerät geschlossen.")
                break
            idle_seconds = 0.0
            log(f"[{ts()}] RAW ({len(data)} Bytes) HEX:  {hexdump(data)}")
            log(f"[{ts()}] RAW TEXT: {printable(data)}")
            splitter.feed(data)
    except KeyboardInterrupt:
        log("Beendet durch Nutzer.")
    finally:
        stop_event.set()
        sock.close()
        logfile.close()
        print(f"\nLog gespeichert unter: {logname}")


if __name__ == "__main__":
    main()
