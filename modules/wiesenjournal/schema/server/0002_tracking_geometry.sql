-- Server-only, wie schema/server/0001_postgis_geometry.sql — pglites
-- Migrations-Glob ist nicht rekursiv und sieht diesen Ordner nie, pglite
-- hat ohnehin keine PostGIS-Extension. Konvertiert die frisch angelegten
-- tracks.geometry (LineString) und weed_observations.geometry (Point) von
-- TEXT auf echte PostGIS-Geometrie, direkt im Anschluss an schema/
-- 0005_tracking.sql — kein Bestandsdaten-Problem, da die Tabellen neu sind.

-- tracks ist seit Oktober 2026 im Modul Betrieb (dort server/0001); bei
-- einer neuen Installation existiert die Tabelle hier nicht mehr.
do $$
begin
  if to_regclass('tracks') is not null then
    alter table tracks
      alter column geometry type geometry(LineString, 4326)
      using ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326);
    create index if not exists idx_tracks_geom on tracks using gist (geometry);
  end if;
end $$;

alter table weed_observations
  alter column geometry type geometry(Point, 4326)
  using ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326);

create index idx_weed_observations_geom on weed_observations using gist (geometry);
