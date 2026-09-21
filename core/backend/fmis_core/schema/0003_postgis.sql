-- Aktiviert PostGIS einmalig auf Datenbankebene (landet im Schema 'public',
-- das search_path jedes Modul-Pools bereits enthält, siehe fmis_core/db.py —
-- der Typ `geometry` ist dadurch unqualifiziert aus jedem Modul-Schema
-- nutzbar). Serverseitig only — pglite/Client bleiben bewusst bei
-- GeoJSON-Text, siehe modules/fields/schema/0007_postgis_geometry.sql und
-- modules/wiesenjournal/schema/0004_postgis_geometry.sql für die Begründung.
-- `if not exists`: idempotent, unabhängig davon ob das postgis/postgis-
-- Image die Extension beim (Erst-)Init eines frischen Datenverzeichnisses
-- schon selbst angelegt hat.
create extension if not exists postgis;
