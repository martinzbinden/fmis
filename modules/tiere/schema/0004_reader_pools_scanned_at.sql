-- Zeitpunkt des letzten Datensatzes der Gruppe im Gerät (Ortszeit des Geräts, hier als Zeitpunkt).
alter table reader_pools add column scanned_at timestamptz;

-- Erster Abgleich mit dem echten Gerät (12.11.2026) kannte das Format noch nicht und legte je Gruppe eine
-- Zeile mit falsch zerlegter Kennung ab (Kennung begann mit «[»). Diese Zeilen sind wertlos: ausblenden;
-- der nächste Abgleich holt die Gruppen mit richtiger Auswertung als Altbestand neu.
update reader_pools set deleted_at = now(), updated_at = now() where device_group_id like '[%' and deleted_at is null;
