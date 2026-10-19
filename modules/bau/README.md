# Bauprojekte (`bau`)

Leitungen, Schächte und Gebäude planen, auf der swisstopo-Karte einzeichnen und
vor Ort per GPS einmessen — mit Export für Bauunternehmer, Geometer und GIS.

- **Daten:** `projects`, `features` (Linie/Punkt/Fläche, Kategorie, Status,
  Material, Durchmesser, Verlegetiefe; `plan_geometry` hält die ursprüngliche
  Planlinie, wenn die Geometrie durch Einmessen ersetzt wurde),
  `survey_points` (Rohdaten mit Genauigkeit, Höhe, Tiefe, Punktnummer).
- **Rechte:** `bau:projekte:read/write`, `bau:history:read` (abgeleitet aus den
  Kulturen-Rechten, `core/.../0009_bau_module.sql`).
- **Karte:** `core/frontend/src/swisstopo.ts` (Luftbild, Landeskarte, WMS der
  amtlichen Vermessung — liefert deckend, daher `mix-blend-multiply`),
  `core/frontend/src/lv95.ts` (WGS84 ↔ LV95, ±1 m). Kulturflächen werden nur
  lesend aus dem Modul Kulturen angezeigt.
- **Reine Funktionen** (alle mit Tests, `frontend/src/lib/`): `geometry`,
  `kml`/`kmz`, `geojson`, `gpx`, `csv`, `dxf`, `exports`, `importPlan`, `survey`.
- **DXF:** AutoCAD R2000 (AC1015), LV95 in Metern, ein Layer je Kategorie
  (`GUELLE`, `STROM`, `LEERROHR`, `SCHACHT`, … optional `_GEPLANT`/`_EINGEMESSEN`),
  LWPOLYLINE/POINT/TEXT, reines ASCII. In LibreCAD geöffnet und geprüft.
- **Genauigkeit:** Handy-GPS liegt bei etwa ±3–5 m. Die App zeigt die
  Genauigkeit je Messpunkt, warnt ab 5 m (sperrt aber nicht) und exportiert sie
  mit. Für Geometer-taugliches Einmessen braucht es einen RTK-Empfänger.
- **Import:** KML/KMZ/GeoJSON ergänzen nur (Name + Geometrie gleich → überspringen).
