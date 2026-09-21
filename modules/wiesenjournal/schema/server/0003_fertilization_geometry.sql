-- Server-only (pglite sieht diesen Ordner nicht): Massnahmen-Geometrie als
-- PostGIS-Spalte für Verschneidung (resolve-extent) und Düngungskarte.
alter table fertilization_entries
  alter column geometry type geometry(Geometry, 4326)
  using case when geometry is null then null else ST_SetSRID(ST_GeomFromGeoJSON(geometry), 4326) end;
create index idx_fert_entries_geom on fertilization_entries using gist (geometry);
