-- Server: GeoJSON-Text → PostGIS-geometry (siehe modules/fields/schema/server/
-- 0001_postgis_geometry.sql). Der Client (pglite) bleibt bei Text; die
-- Umwandlung macht core/backend/fmis_core/sync_push.py (ST_GeomFromGeoJSON)
-- und sync.py (ST_AsGeoJSON). Liegt in server/, weil pglite kein PostGIS kennt.

alter table features
  alter column geometry type geometry(Geometry, 4326)
  using case when geometry is null then null else ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326) end;

alter table features
  alter column plan_geometry type geometry(Geometry, 4326)
  using case when plan_geometry is null then null else ST_SetSRID(ST_GeomFromGeoJSON(plan_geometry), 4326) end;

create index idx_features_geom on features using gist (geometry);
