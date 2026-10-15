-- Server: Spur als PostGIS-LineString (pglite hat kein PostGIS und sieht
-- diesen Ordner nicht).
alter table tracks
  alter column geometry type geometry(LineString, 4326)
  using ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326);
create index idx_tracks_geom on tracks using gist (geometry);
