-- Belegung (Natursprung): Farbe des Deckgurts / Farbstifts am Widder bzw. Stier zum Zeitpunkt der Meldung
-- (blau, gruen, rot, violett). Die «momentan gültige Farbe» je Vatertier ist die der letzten Meldung mit Farbe
-- (frontend/src/lib/markerColor.ts).
alter table matings add column marker_color text;
