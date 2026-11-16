#!/usr/bin/env python3
"""AGFF-Wiesenjournal ins FMIS holen (Spiegel unter modules/wiesenjournal/frontend/src/agff/).

Das AGFF-Journal (github.com/AGFF-ADCF-APF/agff-app-journal, EUPL-1.2) ist aus diesem Modul entstanden und wird dort
weiterentwickelt. Das FMIS übernimmt dessen Dateien UNVERÄNDERT in einen Spiegel und verbindet sie über eine Brücke
(agff/db/db.ts → pglite, agff/fmis/) mit Datenbank, Sync, Verlauf und Adressen des FMIS. So lassen sich spätere
Neuerungen mit einem Befehl holen.

Welche Dateien kommen mit: alle, die von den Einstiegen (HERKUNFT.json «einstiege») aus importiert werden, dazu deren
Tests. «lokal» sind Dateien, die das FMIS an Stelle der AGFF-Fassung führt (werden nie überschrieben; bei Änderungen
der AGFF-Fassung zeigt das Werkzeug den Unterschied zum Nachführen). «ausgeschlossen» kommt nie mit (Anmeldung,
Cloud, Sicherungsdatei, Kacheln); importiert eine gespiegelte Datei so eine, bricht das Werkzeug ab.

Änderungen beim Kopieren: `from 'react-router-dom'` zeigt auf agff/fmis/router.tsx, das absolute AGFF-Adressen
(«/tag», «/parzelle/…») auf /wiesenjournal/… umlegt; «Wunsch Martin» u.ä. in Kommentaren wird «Wunsch des Betriebs»
(öffentliches Repo ohne Personennamen). index.css wird zu agff/agff.css (ohne @tailwind, ohne
html/body-Grundstil, Druckformat nur für die Druckseite).

    tools/agff_journal.py stand            # was gibt es Neues seit dem letzten Holen?
    tools/agff_journal.py holen [REV]      # Spiegel auf REV (Vorgabe origin/main) bringen
    tools/agff_journal.py pruefen          # Spiegel unverändert? (sonst wurde von Hand darin gearbeitet)

Danach: Tests (frontend: npm test), Build, im Browser ansehen; bei «lokal geändert» die AGFF-Änderung von Hand in die
FMIS-Fassung übernehmen.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ZIEL = REPO / 'modules/wiesenjournal/frontend/src/agff'
HERKUNFT = ZIEL / 'HERKUNFT.json'
QUELLE = 'https://github.com/AGFF-ADCF-APF/agff-app-journal.git'
CACHE = Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'fmis' / 'agff-app-journal'
FMIS_DIR = 'fmis'  # agff/fmis/: nur FMIS, vom Werkzeug nie angefasst
IMPORT_RE = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}/[^'"]+)['"]""", re.M)
ROUTER_RE = re.compile(r"""from\s+(['"])react-router-dom\1""")
# Das FMIS-Repo ist öffentlich und enthält keine Personennamen: «Wunsch Martin» usw. in AGFF-Kommentaren wird neutral
NAMEN_RE = re.compile(r'\b(Entscheid|Wunsch|Vorgabe|Go|Freigabe|von) Martin\b')


def git(*args: str, cwd: Path = CACHE) -> str:
    return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def cache_holen() -> None:
    if not (CACHE / '.git').exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'clone', '-q', QUELLE, str(CACHE)], check=True)
    else:
        git('fetch', '-q', 'origin')


def manifest() -> dict:
    return json.loads(HERKUNFT.read_text())


def datei_am(rev: str, pfad: str) -> str | None:
    try:
        return git('show', f'{rev}:src/{pfad}')
    except subprocess.CalledProcessError:
        return None


def dateien_am(rev: str) -> set[str]:
    return {p[len('src/'):] for p in git('ls-tree', '-r', '--name-only', rev, 'src').split()}


def aufloesen(von: str, imp: str, vorhanden: set[str]) -> str | None:
    p = os.path.normpath(os.path.join(os.path.dirname(von), imp))
    for kandidat in (p, p + '.ts', p + '.tsx', p + '/index.ts'):
        if kandidat in vorhanden:
            return kandidat
    return None


def passt(pfad: str, muster: list[str]) -> bool:
    return any(fnmatch.fnmatch(pfad, m) for m in muster)


def huelle(rev: str, m: dict) -> tuple[set[str], list[str]]:
    """Alle zu spiegelnden Dateien ab den Einstiegen (ohne lokal/ausgeschlossen) + Tests. Fehler als Liste."""
    vorhanden = dateien_am(rev)
    fehler: list[str] = []
    gesehen: set[str] = set()
    lokal_besucht: set[str] = set()

    def importe(pfad: str, text: str) -> list[str]:
        out = []
        for imp in IMPORT_RE.findall(text):
            if os.path.normpath(os.path.join(os.path.dirname(pfad), imp)).startswith(FMIS_DIR + '/'):
                continue  # FMIS-eigene Brücke (agff/fmis/)
            r = aufloesen(pfad, imp, vorhanden)
            if r is None:
                if not imp.endswith('.css') and not imp.startswith('../../public'):
                    fehler.append(f'{pfad}: Import {imp} nicht gefunden')
                continue
            out.append(r)
        return out

    def besuchen(start: list[str]) -> set[str]:
        neu: set[str] = set()
        stapel = list(start)
        while stapel:
            p = stapel.pop()
            if p in gesehen or p in neu:
                continue
            if passt(p, m['ausgeschlossen']):
                raise ValueError(p)
            if p in m['lokal']:
                # FMIS-Fassung: deren Importe zählen
                if p in lokal_besucht:
                    continue
                lokal_besucht.add(p)
                text = (ZIEL / p).read_text()
                stapel.extend(importe(p, text))
                continue
            text = datei_am(rev, p)
            if text is None:
                fehler.append(f'{p}: fehlt in {rev}')
                continue
            neu.add(p)
            stapel.extend(importe(p, text))
        return neu

    try:
        gesehen |= besuchen(m['einstiege'])
    except ValueError as e:
        fehler.append(f'eine Einstiegsdatei importiert {e.args[0]} (ausgeschlossen)')
        return gesehen, fehler
    # Tests der gespiegelten Dateien, sofern sie nichts Ausgeschlossenes brauchen und keine Demo-Dateien lesen
    for p in sorted(gesehen):
        t = re.sub(r'\.tsx?$', '.test.ts', p)
        if t not in vorhanden or passt(t, m.get('tests_ohne', [])):
            continue
        text = datei_am(rev, t) or ''
        if 'demoFile(' in text or 'public/' in text:
            continue
        try:
            gesehen |= besuchen([t])
        except ValueError:
            continue
    for z in m.get('zusatz', []):
        gesehen |= {p for p in vorhanden if fnmatch.fnmatch(p, z)}
    return gesehen, fehler


def umformen(pfad: str, text: str) -> str:
    if pfad.endswith(('.ts', '.tsx')):
        tiefe = pfad.count('/')
        rel = ('../' * tiefe or './') + f'{FMIS_DIR}/router'
        text = ROUTER_RE.sub(f"from '{rel}'", text)
    if pfad.endswith(('.ts', '.tsx', '.css', '.md')):
        text = NAMEN_RE.sub(lambda m: f'{m.group(1)} des Betriebs' if m.group(1) != 'von' else 'vom Betrieb', text)
    return text


def css_umformen(text: str) -> str:
    """index.css der AGFF → agff.css im FMIS (wird von frontend/src/index.css eingebunden)."""
    text = re.sub(r'^@tailwind [a-z]+;\n', '', text, flags=re.M)
    # Grundstil der Seite gehört dem FMIS
    text = re.sub(r'^html,\nbody \{[^}]*\}\n\n?', '', text, flags=re.M)
    text = re.sub(r'^body \{[^}]*\}\n\n?', '', text, flags=re.M)
    # A4 quer nur für die Druckseite, nicht für jeden Druck im FMIS
    text = text.replace('@page {', '@page agffdruck {')
    text += '\n/* FMIS: benanntes Druckformat (tools/agff_journal.py) */\n.druck-seite {\n  page: agffdruck;\n}\n'
    return '/* Gespiegelt aus agff-app-journal src/index.css – nicht von Hand ändern (tools/agff_journal.py). */\n' + text


def befehl_stand() -> int:
    cache_holen()
    m = manifest()
    alt, neu = m['commit'], git('rev-parse', 'origin/main').strip()
    print(f"Gespiegelt: {alt[:7]} ({m.get('datum', '?')}), AGFF origin/main: {neu[:7]}")
    if neu.startswith(alt):
        print('Nichts Neues.')
        return 0
    print('\nNeue Commits:')
    print(git('log', '--format=  %h %ad %s', '--date=short', f'{alt}..{neu}'))
    geaendert = git('diff', '--name-only', alt, neu, '--', 'src').split()
    gespiegelt = set(m['dateien'])
    rel = [p[len('src/'):] for p in geaendert]
    print('Im Spiegel betroffen:', ', '.join(p for p in rel if p in gespiegelt) or '–')
    print('FMIS-Fassung nachführen (lokal):', ', '.join(p for p in rel if p in m['lokal']) or '–')
    andere = [p for p in rel if p not in gespiegelt and p not in m['lokal']]
    print('Nicht gespiegelt (neue Seiten/ausgeschlossen):', ', '.join(andere) or '–')
    return 0


def befehl_holen(rev: str) -> int:
    cache_holen()
    m = manifest()
    voll = git('rev-parse', rev).strip()
    dateien, fehler = huelle(voll, m)
    if fehler:
        print('Abbruch:\n  ' + '\n  '.join(fehler))
        return 1
    alt = set(m.get('dateien', []))
    for p in sorted(alt - dateien):
        (ZIEL / p).unlink(missing_ok=True)
        print(f'  weg   {p}')
    for p in sorted(dateien):
        ziel = ZIEL / p
        ziel.parent.mkdir(parents=True, exist_ok=True)
        text = git('show', f'{voll}:src/{p}') if not p.endswith(('.ts', '.tsx', '.css', '.md', '.json')) else datei_am(voll, p)
        neu = umformen(p, text or '')
        if not ziel.exists() or ziel.read_text() != neu:
            print(f"  {'neu  ' if not ziel.exists() else 'geänd'} {p}")
            ziel.write_text(neu)
    css = datei_am(voll, 'index.css')
    if css is not None:
        (ZIEL / 'agff.css').write_text(umformen('agff.css', css_umformen(css)))
    lizenz = git('show', f'{voll}:LICENSE')
    (ZIEL / 'LICENSE').write_text(lizenz)
    # lokal: AGFF-Änderungen seit dem letzten Holen zeigen
    if not voll.startswith(m['commit']):
        for p in m['lokal']:
            d = git('diff', m['commit'], voll, '--', f'src/{p}')
            if d.strip():
                print(f'\n=== AGFF hat {p} geändert – in die FMIS-Fassung übernehmen, wo sinnvoll:\n{d}')
    m['commit'] = voll[:12]  # kurz: die Commit-Prüfung hält 40 Hex-Zeichen für einen Schlüssel
    m['datum'] = git('show', '-s', '--format=%cs', voll).strip()
    m['dateien'] = sorted(dateien)
    HERKUNFT.write_text(json.dumps(m, indent=2, ensure_ascii=False) + '\n')
    print(f'\nSpiegel auf {voll[:7]} ({m["datum"]}), {len(dateien)} Dateien. Jetzt Tests und Build laufen lassen.')
    return 0


def befehl_pruefen() -> int:
    cache_holen()
    m = manifest()
    abw = []
    for p in m['dateien']:
        soll = umformen(p, datei_am(m['commit'], p) or '')
        ist = (ZIEL / p).read_text() if (ZIEL / p).exists() else None
        if ist != soll:
            abw.append(p)
    css = datei_am(m['commit'], 'index.css')
    if css is not None and (ZIEL / 'agff.css').read_text() != umformen('agff.css', css_umformen(css)):
        abw.append('agff.css')
    if abw:
        print('Von Hand geändert (gehört in agff/fmis/, lokal oder zur AGFF):\n  ' + '\n  '.join(abw))
        return 1
    print(f"Spiegel unverändert ({len(m['dateien'])} Dateien, AGFF {m['commit'][:7]}).")
    return 0


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    if argv[0] == 'stand':
        return befehl_stand()
    if argv[0] == 'holen':
        return befehl_holen(argv[1] if len(argv) > 1 else 'origin/main')
    if argv[0] == 'pruefen':
        return befehl_pruefen()
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
