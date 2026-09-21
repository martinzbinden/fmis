-- Konvertiert die bisherigen GeoJSON-Text-Spalten auf echte PostGIS-
-- geometry-Spalten (server-seitig, siehe core/backend/fmis_core/schema/
-- 0003_postgis.sql). Client (pglite) bleibt bei reinem Text/GeoJSON — die
-- Umwandlung passiert ausschliesslich in backend/app/sync.py. Ermöglicht
-- echte räumliche Abfragen (ST_Intersects/ST_Intersection) gegen
-- fields.field_declarations, z.B. für den Jahresauswertungs-Report
-- (backend/app/reports.py) — Zäune/Weidegänge müssen sich dafür NICHT an
-- die GELAN-Parzellengrenzen halten, die Überlappung wird stattdessen
-- berechnet statt referenziert (siehe README: "Variante 1").
--
-- WICHTIG: liegt bewusst in schema/server/ statt direkt in schema/ — Dateien
-- direkt unter schema/*.sql werden 1:1 auch client-seitig in pglite
-- angewendet (frontend/src/db/pglite.ts, nicht rekursiv). pglite hat keine
-- PostGIS-Extension, ST_GeomFromGeoJSON würde dort fehlschlagen. Alles unter
-- schema/server/ wird NUR vom Server-Migrationsrunner angewendet
-- (core/backend/fmis_core/db.py: run_migrations()), nie von pglite.

-- v_paddocks_current ist eine "select *"-View über paddocks und blockiert
-- deshalb ein ALTER COLUMN TYPE auf dessen geometry-Spalte.
drop view v_paddocks_current;

alter table paddocks
  alter column geometry type geometry(Geometry, 4326)
  using ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326);

alter table parcels
  alter column base_geometry type geometry(Geometry, 4326)
  using ST_SetSRID(ST_GeomFromGeoJSON(base_geometry), 4326);

create view v_paddocks_current as
  select * from paddocks where is_current and deleted_at is null;

create index idx_paddocks_geom on paddocks using gist (geometry);
create index idx_parcels_geom on parcels using gist (base_geometry);
