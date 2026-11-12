#!/usr/bin/env python3
"""Aufgaben (Task-Modus) für den Agrident APR600 als Projektdatei für AgriLink erzeugen.

Der APR600 zeigt im Menü «Tasks» eigene Eingabeabläufe, sobald Aufgaben-Definitionen hochgeladen sind
(Handbuch Kap. 7.4). AgriLink lädt solche Dateien («Load Tasks from File», dann «Upload Task Definitions»).
Das Dateiformat steht nirgends veröffentlicht; es ist hier aus AgriLink.exe selbst abgelesen (CTask,
CTaskProject, modTaskCheck, 12.11.2026) und NICHT mit einer echten Aufgabe verglichen — AgriLink prüft die
Datei beim Laden und meldet Fehler im Klartext.

Aufbau (INI, Windows-1252, CRLF):

    [Project]
    FileType=20562
    FileVersion=1

    [Task.1.Definition]          ; 1..9 beim APR600
    Name=Ablammung
    Description=...
    Fields=5                     ; Anzahl Felder (höchstens 40)
    Field0=Name,Typ,Länge,Dezimalstellen,Alphanumerisch,Klasse,AnzahlOptionen,Wiederholungen,RecEIC,BedingungNeu,BedingungÄndern,Autoedition
    FieldDescription0=Hilfetext
    Option1.0=Anzeige,Wert      ; Option<Feld>.<Nr>, beide ab 0; höchstens 16 je Feld
    FieldsDownload=0,1,2        ; Reihenfolge der Felder in den heruntergeladenen Daten (40 = leer)

Feldtypen (FELDTYPEN in AgriLink): 0 fest, 1 Auswahlliste, 2 Zahl, 3 Text, 4 Datum, 5 Zeit, 7 Ohrmarke lesen,
8 Ohrmarke eintippen, 51 erweiterte Auswahl, 57 Barcode, 81/82 Schleife, 84 Schnellschleife.
Jedes Feld nach der Ohrmarke verweist über RecEIC auf das Ohrmarken-Feld (davor), zu dem es gehört.
Bedingung 13 = immer, 14 = nie.

Nutzung:
    python3 tools/apr600_tasks.py ablammung -o Ablammung.apr
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

FILE_TYPE = 20562
FILE_VERSION = 1
MAX_TASKS_APR = 9
MAX_FIELDS = 40
MAX_OPTIONS = 16
COND_ALWAYS = 13

T_SELECTION = 1
T_NUMERIC = 2
T_ALPHA = 3
T_DATE = 4
T_TIME = 5
T_EIC = 7  # Ohrmarke lesen
T_ENTERED_EIC = 8
KNOWN_TYPES = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 51, 56, 57, 81, 82, 83, 84, 85, 86, 87, 88, 89}


@dataclass
class Option:
    text: str
    value: str


@dataclass
class Field:
    name: str
    typ: int
    description: str = ""
    length: int = 10
    decimals: int = 0
    alphanumeric: int = 0
    group: int = 0
    repetitions: int = 1
    #: Nummer des Ohrmarken-Felds, zu dem dieses Feld gehört
    rec_eic: int = 0
    cond_new: int = COND_ALWAYS
    cond_mod: int = COND_ALWAYS
    autoedition: int = 0
    options: list[Option] = field(default_factory=list)


@dataclass
class Task:
    name: str
    description: str = ""
    fields: list[Field] = field(default_factory=list)
    pre_download: str = ""
    post_download: str = ""


def check_task(task: Task) -> list[str]:
    """Regeln aus AgriLink (modTaskCheck, modTaskProject), soweit abgelesen. Leere Liste = in Ordnung."""
    problems: list[str] = []
    if not task.name.strip():
        problems.append("Aufgabe ohne Namen")
    if not 1 <= len(task.fields) <= MAX_FIELDS:
        problems.append(f"{len(task.fields)} Felder (erlaubt 1 bis {MAX_FIELDS})")
    for i, f in enumerate(task.fields):
        where = f"Feld {i} «{f.name}»"
        if f.typ not in KNOWN_TYPES:
            problems.append(f"{where}: unbekannter Feldtyp {f.typ}")
        if len(f.options) > MAX_OPTIONS:
            problems.append(f"{where}: {len(f.options)} Optionen (höchstens {MAX_OPTIONS})")
        if f.typ == T_SELECTION and not f.options:
            problems.append(f"{where}: Auswahlliste ohne Optionen")
        if f.typ != T_SELECTION and f.options:
            problems.append(f"{where}: Optionen nur bei Auswahllisten")
        # Verweis auf das Ohrmarken-Feld: muss vor diesem Feld stehen und eines zum Ablesen sein
        if f.typ != T_EIC and f.typ < 85:
            if not 0 <= f.rec_eic < len(task.fields):
                problems.append(f"{where}: verweist auf Feld {f.rec_eic}, das es nicht gibt")
            elif task.fields[f.rec_eic].typ != T_EIC:
                problems.append(f"{where}: verweist auf ein Feld, das keine Ohrmarke liest (Feld {f.rec_eic})")
            elif f.rec_eic > i:
                problems.append(f"{where}: verweist auf Feld {f.rec_eic}, das danach kommt")
        # Name und Optionen stehen in kommagetrennten Listen; Beschreibungen sind ganze Zeilen
        for text in [f.name, *[o.text for o in f.options], *[o.value for o in f.options]]:
            if any(ord(c) > 126 or c in ",\r\n" for c in text):
                problems.append(f"{where}: «{text}» enthält Komma, Zeilenumbruch oder Zeichen ausserhalb von ASCII")
        if any(ord(c) > 126 or c in "\r\n" for c in f.description):
            problems.append(f"{where}: Beschreibung enthält Zeilenumbruch oder Zeichen ausserhalb von ASCII")
    if sum(1 for f in task.fields if f.typ == T_EIC) == 0:
        problems.append("kein Feld, das die Ohrmarke liest")
    return problems


def render_project(tasks: list[Task]) -> str:
    """Projektdatei (Text, Zeilen mit \\n; beim Schreiben CRLF und Windows-1252)."""
    if not 1 <= len(tasks) <= MAX_TASKS_APR:
        raise ValueError(f"{len(tasks)} Aufgaben (der APR600 hat Platz für {MAX_TASKS_APR})")
    lines = ["[Project]", f"FileType={FILE_TYPE}", f"FileVersion={FILE_VERSION}", ""]
    for n, task in enumerate(tasks, start=1):
        problems = check_task(task)
        if problems:
            raise ValueError(f"Aufgabe «{task.name}»: " + "; ".join(problems))
        lines += [f"[Task.{n}.Definition]", f"Name={task.name}", f"Description={task.description}"]
        if task.pre_download:
            lines.append(f"PreDownload={task.pre_download}")
        if task.post_download:
            lines.append(f"PostDownload={task.post_download}")
        lines.append(f"Fields={len(task.fields)}")
        for i, f in enumerate(task.fields):
            parts = [f.name, f.typ, f.length, f.decimals, f.alphanumeric, f.group, len(f.options), f.repetitions, f.rec_eic, f.cond_new, f.cond_mod, f.autoedition]
            lines.append(f"Field{i}=" + ",".join(str(p) for p in parts))
            if f.description:
                lines.append(f"FieldDescription{i}={f.description}")
            for j, o in enumerate(f.options):
                lines.append(f"Option{i}.{j}={o.text},{o.value}")
        lines.append("FieldsDownload=" + ",".join(str(i) for i in range(len(task.fields))))
        lines.append("")
    return "\n".join(lines)


def write_project(tasks: list[Task], path: str) -> None:
    text = render_project(tasks)  # erst prüfen, dann die Datei anlegen
    with open(path, "w", encoding="cp1252", newline="") as fh:
        fh.write(text.replace("\n", "\r\n"))


def parse_project(text: str) -> list[Task]:
    """Gegenstück zum Lesen in AgriLink (CTask.LoadFromFile): für den Rundlauf-Test."""
    sections: dict[str, dict[str, str]] = {}
    current: dict[str, str] | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        if line.startswith("[") and line.endswith("]"):
            current = sections.setdefault(line[1:-1], {})
        elif current is not None and "=" in line:
            k, _, v = line.partition("=")
            current[k.strip()] = v.strip()
    head = sections.get("Project", {})
    if int(head.get("FileType", 0)) != FILE_TYPE or int(head.get("FileVersion", 0)) != FILE_VERSION:
        raise ValueError("keine AgriLink-Projektdatei")
    tasks: list[Task] = []
    for n in range(1, 26):
        sec = sections.get(f"Task.{n}.Definition")
        if sec is None:
            continue
        task = Task(sec.get("Name", "no name"), sec.get("Description", ""), pre_download=sec.get("PreDownload", ""), post_download=sec.get("PostDownload", ""))
        for i in range(int(sec.get("Fields", 0))):
            v = sec[f"Field{i}"].split(",")
            f = Field(v[0], int(v[1]), sec.get(f"FieldDescription{i}", ""), int(v[2]), int(v[3]), int(v[4]), int(v[5]), int(v[7]), int(v[8]), int(v[9]), int(v[10]), int(v[11]))
            for j in range(int(v[6])):
                text, _, value = sec[f"Option{i}.{j}"].partition(",")
                f.options.append(Option(text, value))
            task.fields.append(f)
        tasks.append(task)
    return tasks


def ablammung() -> Task:
    """Ablammung bei Schafen: Mutter lesen, dann je Lamm Geschlecht oder «tot geboren».

    Die Ohrmarke der Lämmer gibt es bei der Geburt meist noch nicht (FMIS: «Ohrmarke später»); darum
    wird nur das Mutterschaf gelesen. Datum und Zeit stehen im Datensatz des Geräts."""
    sex = [Option("Aue (w)", "w"), Option("Widder (m)", "m"), Option("tot geboren", "t")]
    lambs = [Field(f"Lamm {n}", T_SELECTION, f"Geschlecht des {n}. Lamms" if n == 1 else f"{n}. Lamm, falls vorhanden", options=([*sex] if n == 1 else [Option("kein Lamm", "-"), *sex])) for n in range(1, 5)]
    return Task(
        "Ablammung",
        "Mutter lesen, dann je Lamm Geschlecht",
        [Field("Mutter", T_EIC, "Ohrmarke der Mutter lesen", length=15), *lambs],
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aufgabe", choices=["ablammung"], help="welche Aufgabe")
    ap.add_argument("-o", "--out", required=True, help="Zieldatei (.apr)")
    args = ap.parse_args(argv)
    write_project([ablammung()], args.out)
    print(f"geschrieben: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
