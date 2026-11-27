# Wiesenjournal: Rückimport aus dem AGFF-Journal

Stand 16.11.2026, AGFF-Commit d3ea5c2 (0.23.3).

Das AGFF-Wiesenjournal ([github.com/AGFF-ADCF-APF/agff-app-journal](https://github.com/AGFF-ADCF-APF/agff-app-journal),
EUPL-1.2) entstand am 12.11.2026 aus diesem Modul (FMIS 59425bb) und wurde dort als Web-App ohne Server weiterentwickelt.
Seine Seiten kommen jetzt zurück ins FMIS, **ohne sie umzuschreiben**: Sie liegen als Spiegel unter
`modules/wiesenjournal/frontend/src/agff/`, und eine Brücke verbindet sie mit Datenbank, Sync, Verlauf und Adressen des FMIS.
So lassen sich spätere AGFF-Neuerungen mit einem Befehl holen.

## Aufbau

```
modules/wiesenjournal/frontend/src/agff/
  HERKUNFT.json        Quelle, Commit, Einstiege, «lokal», «ausgeschlossen», Dateiliste des Spiegels
  LICENSE              EUPL-1.2 (wie das ganze FMIS)
  agff.css             Bausteine .btn/.chip/.card/.inp und Druckformat (aus index.css, eingebunden in frontend/src/index.css)
  pages/ components/ lib/ hooks/ db/ types.ts test/   Spiegel – nie von Hand ändern
  db/db.ts             lokal: öffnet den AGFF-Store mit pglite statt IndexedDB
  pages/MorePage.tsx   lokal: «Mehr» ohne Konto/Cloud/Sicherung
  components/ParzellenAnlegen.tsx   lokal: Parzellen kommen im FMIS aus GELAN (Seite Parzellen)
  fmis/                FMIS-eigen, vom Werkzeug nie angefasst
    router.tsx         react-router-dom für den Spiegel: «/tag» → /wiesenjournal/heute usw.
    persist.ts         Speicher hinter dem Store: Laden aus pglite, Schreiben über core/writer (Outbox, Verlauf, Rückgängig)
    abbildung.ts       Zeilen FMIS ↔ AGFF (+ Tests), Herden aus dem Modul Tiere
    AgffSeite.tsx      öffnet den Store vor der ersten Seite
    JahrWahl.tsx       Leiste «Saison ‹ 2026 ›» über Jahr, Raster plus, Drucken, Fragen (setzt hooks/useYear)
```

Der AGFF-Store hält alle Journal-Zeilen im Speicher, die Seiten lesen synchron. Im FMIS lädt `persist.ts` beim ersten
Öffnen die Tabellen des Wiesenjournals und die Herdengruppen. Jede Änderung geht sofort in den Speicher und dann über den
gewohnten Schreibweg in pglite. Ändert sich etwas von aussen (Sync, eine andere FMIS-Seite, Rückgängig), lädt die Brücke
neu und übernimmt nur, was neuer ist.

## Neuerungen holen

```bash
tools/agff_journal.py stand      # neue AGFF-Commits, betroffene Dateien, «lokal» nachzuführen
tools/agff_journal.py holen      # Spiegel auf origin/main (oder: holen <commit>)
tools/agff_journal.py pruefen    # Spiegel unverändert? (vor dem Commit)
```

Danach: `tsc -b`, Vitest (die AGFF-Tests laufen im FMIS mit), Seiten im Browser ansehen. Zeigt `holen` Änderungen an
einer «lokal»-Datei, die AGFF-Änderung von Hand in die FMIS-Fassung übernehmen. Braucht eine neue AGFF-Seite eine
ausgeschlossene Datei, bricht `holen` ab: dann die Seite als Einstieg weglassen oder eine FMIS-Fassung unter «lokal»
anlegen. Neue AGFF-Spalten oder -Tabellen brauchen eine FMIS-Migration (wie `schema/0029_agff_journal.sql`) und einen
Eintrag in `abbildung.ts`, sonst gehen sie beim Speichern verloren.

Das Werkzeug ändert beim Kopieren nur zweierlei: den Import von `react-router-dom` (→ `fmis/router`) und Personennamen
in Kommentaren («Wunsch Martin» → «Wunsch des Betriebs»; das FMIS-Repo ist öffentlich). Was dort umgelegt wird, steht
in `UMLEITUNG` in `fmis/router.tsx`. Gibt es eine AGFF-Adresse, die das FMIS anders nennt, gehört sie dorthin.

## Was im FMIS dazukam

| Seite (Menü Wiesenjournal) | aus dem AGFF-Journal |
|---|---|
| **Heute** (`/wiesenjournal/heute`) | Tageskarte: Weide, Schnitt, Düngen, Pflege als Masken; Weide/Auslauf-Automatik; Laufhof auto/L/0 mit Ausnahmen; Herden umziehen, austreiben; «wie gestern», «könnte fällig sein», «in der Nähe»; Regen des Tages und der Woche |
| **Raster plus** (`/wiesenjournal/raster`, unter Mehr und im Ansicht-Umschalter) | Woche/Monat/Saison, Tastatur, Kürzel in der Zelle, Kopieren/Einfügen, Finder mit Sternen und Chips, Kurznamen, Niederschlag-Zeile, Summenspalte |
| **Jahr** | Wochen als Spalten, Jahresband je Parzelle |
| **Steckbrief** (`/wiesenjournal/parzelle/<id>`) | Kennzahlen, Jahresband, Verlauf mit Regen nach jeder Düngung, Masken |
| **Drucken** | Formular im Format des AGFF-Wiesenjournals (A4 quer, nur für diese Seite) |
| **Suchen und Fragen** | letzte Düngung, Güllegaben seit, nicht geschnitten, Weidetage, Regen seit …; CSV |
| **Mehr** | Startansicht, Schnellerfassung, kleine Parzellen, Kurznamen, Links zu Journal, Parzellen, Auswertung, Düngerarten |

Datenbank (`schema/0029_agff_journal.sql`): Parzellen `favorit`, `immer_zeigen`, `name_import`; Gaben `container_size`,
`incomplete`; Laufhof je Kategorie als Zeichen **X/L/0** statt Häkchen (bisher ✓ → L, sonst automatisch); neue Tabellen
`auslauf_ausnahmen` und `journal_einstellungen`.

Niederschlag: Die Seiten holen Tageswerte für den Standort des Betriebs von graswachstum.ch (MeteoSchweiz, eine Kachel
von rund 40 × 40 km; es geht nur die Kachelnummer hin) und halten sie im Browser (`localStorage`
`wiesenjournal_agff_geraet`). Ein Wert von Hand in der Tagesmeldung geht vor.

## Prüfung auf Rückschritte

Nichts Bestehendes wurde ersetzt; die AGFF-Seiten kommen dazu.

- **Unverändert da:** das bisherige Raster (Neu/Klassisch, Zusammenfassungsspalten, Filter-Chips, Parzellenblatt,
  Saatangaben, geplante Gaben/Gaben-Übersicht), Journal-Liste, Karte (Weidegänge, Färbung, Wiedergabe der GPS-Spuren),
  Parzellen (GELAN-Übernahme, Formelsuche), Auswertung, Düngerarten, Verlauf, Excel-Import, Herden und Auslauf im Modul
  Tiere, GPS-Tracking im Modul Betrieb.
- **Menü:** unten jetzt Heute · Raster · Jahr · Karte · Mehr. Journal, Parzellen und Auswertung sind unter «Mehr»
  (vorher direkt im Menü).
- **Laufhof:** Das bisherige Raster zeigt jetzt das Zeichen (L, X, 0) statt ✓; die Tagesmeldung setzt weiterhin L per
  Häkchen und zeigt ein gesetztes X oder 0 an. Ältere Geräte, die noch true/false senden, scheitern nicht (Spalte Text);
  gelesen wird true als L.
- **Rechnungen:** Nährstoffrechnung (`nutrients.ts`) ist in beiden gleich. Die AGFF-Seiten rechnen Anteile von Teilflächen
  im Browser (`agff/lib/geo.ts`); die FMIS-Auswertung bleibt bei PostGIS.
- **Bewusst anders als in der AGFF-App:**
  - Herden sind die Herdengruppen des Moduls Tiere (keine zweite Herdenführung). Umziehen, Austreiben, «nicht hier»
    schreiben Weide-Aufenthalte (`herd_stays`); der Stall läuft dort weiter und füllt im Journal die Tage ohne Weide.
    «Einstallen mit Laufhof/ohne Auslauf» setzt kein Stall-Merkmal; das kommt vom Stall (Ort) im Modul Tiere
    (Laufhof ständig → L, keiner → 0). Weide an einem Ort ohne Parzelle (Alp) gilt im Journal als «nicht auf dem Betrieb».
  - «Neue Herde» legt eine Herdengruppe im Modul Tiere an (Tierart aus der Kategorie, Anzahl als Bestand ohne Nummern).
  - Geplante Nutzungen und Gaben (Soll) erscheinen auf den AGFF-Seiten nicht; sie bleiben im bisherigen Raster.
  - Fahrten (GPS reduziert) und Unkraut der AGFF-App sind nicht dabei; das FMIS hat dafür Tracking und die Karte.
- **Nicht übernommen:** Anmeldung/Sperre/Passkey, Cloud, Sicherungsdatei, Offline-Kacheln, Parzellen von
  geodienste.ch, Parzellen zeichnen/Liste/Beispielbetrieb, Bearbeiten-Modus «eigene Reihenfolge» (die Sortierung
  «eigene Reihenfolge» nutzt `parcels.sort_order`), AGFF-Auswertung mit Regen (die FMIS-Auswertung bleibt), AGFF-Karte.
  Jede davon lässt sich später als Einstieg in `HERKUNFT.json` aufnehmen.

## Lizenz

Das AGFF-Journal steht unter der EUPL-1.2 (© AGFF). Seit diesem Rückimport steht das ganze FMIS unter der EUPL-1.2
(Entscheid 16.11.2026, Datei `LICENSE` im Repo).
