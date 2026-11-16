# Fixture Niederschlag (graswachstum.ch)

Ausschnitt aus `https://apps.graswachstum.ch/growth/ebenen/tage/niederschlag_2026/`, abgerufen am 16.11.2026
(Stand 14.11.2026, 318 Tage ab 1.1.2026).

Quelle: MeteoSchweiz Open Data (RhiresD/RprelimD, 1-km-Gitter), aufbereitet von graswachstum.ch (AGFF).

- `index.json` unverändert.
- `3_2.json`, `4_2.json`: Kacheln mit nur einer echten Zelle, alle anderen auf `null` gesetzt (kleiner):
  - `3_2`, Index 220: Zelle des erfundenen Demohofs im Grossen Moos (`scripts/demo-gelan.mjs`);
  - `4_2`, Index 216: Zelle der Rütti, Zollikofen (`public/demo/ruetti-zollikofen-2025.geojson`).

Werte in Zehntel-mm je Tag. Die Tests fragen graswachstum.ch nie live ab.
