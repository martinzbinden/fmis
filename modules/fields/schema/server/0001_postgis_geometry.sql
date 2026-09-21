-- Konvertiert die bisherigen GeoJSON-Text-Spalten auf echte PostGIS-
-- geometry-Spalten (server-seitig, siehe core/backend/fmis_core/schema/
-- 0003_postgis.sql für die Extension). Client (pglite) sieht davon NICHTS —
-- die Umwandlung passiert ausschliesslich in backend/app/sync.py
-- (ST_AsGeoJSON beim Pull, ST_GeomFromGeoJSON beim Push), pglite bleibt bei
-- reinem Text/GeoJSON. `geometry(Geometry, 4326)` = unbeschränkter Subtyp,
-- da die bestehenden Daten Polygon/MultiPolygon/Point mischen (siehe
-- FieldGeometry in types.ts — Einzelbäume aus dem Raumdatenexport sind Points).
--
-- WICHTIG: liegt bewusst in schema/server/ statt direkt in schema/ — Dateien
-- direkt unter schema/*.sql werden 1:1 auch client-seitig in pglite
-- angewendet (siehe frontend/src/db/pglite.ts: import.meta.glob('../../../
-- schema/*.sql', ...), NICHT rekursiv). pglite hat keine PostGIS-Extension
-- (bewusst, siehe modules/wiesenjournal/README.md "Kein technischer Bezug"-
-- Abschnitt bzw. die PostGIS-Entscheidung dazu) — ST_GeomFromGeoJSON würde
-- dort mit "function does not exist" fehlschlagen. Alles unter schema/server/
-- wird NUR vom Server-Migrationsrunner angewendet (core/backend/fmis_core/
-- db.py: run_migrations()), nie von pglite.

-- v_plan_parcels_current ist eine "select *"-View über plan_parcels und
-- blockiert deshalb ein ALTER COLUMN TYPE auf dessen geometry-Spalte —
-- vorher droppen, nachher identisch neu anlegen (gleiches Muster wie schon
-- einmal für layer_id in schema/0006_plan_layers.sql).
drop view v_plan_parcels_current;

alter table field_declarations
  alter column geometry type geometry(Geometry, 4326)
  using ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326);

alter table plan_parcels
  alter column geometry type geometry(Geometry, 4326)
  using ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326);

create view v_plan_parcels_current as
select * from plan_parcels where is_current and deleted_at is null;

-- v_field_lineage_summary wählt geometry nicht aus (siehe schema/0001_init.sql)
-- und ist von dieser Änderung nicht betroffen.

create index idx_field_declarations_geom on field_declarations using gist (geometry);
create index idx_plan_parcels_geom on plan_parcels using gist (geometry);
