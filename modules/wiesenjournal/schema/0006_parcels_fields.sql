-- Journal-Parzellen = GELAN-Parzellen aus dem Kulturen-Modul (fields).
-- Keine SQL-FK über die Modulgrenze (siehe README, Modul-Isolation) — nur
-- Snapshot-Spalten plus fields_lineage_id als stabiler Schlüssel über die
-- Jahre. Befüllt serverseitig durch POST /wiesenjournal/parcels/import-from-
-- fields (backend/app/parcels_import.py); der Client sieht die Zeilen per Pull.
alter table parcels add column source text not null default 'manual';
alter table parcels add constraint parcels_source_check check (source in ('manual', 'fields', 'excel'));
-- futter = 6xx (Kunstwiesen/Dauergrünland), acker = 5xx (offene Ackerfläche),
-- andere = Rest. Steuert den Umschalter "Ackerkulturen anzeigen".
alter table parcels add column category text not null default 'futter';
alter table parcels add constraint parcels_category_check check (category in ('futter', 'acker', 'andere'));
alter table parcels add column farm_id uuid;
alter table parcels add column farm_name text;
alter table parcels add column fields_lineage_id uuid;
alter table parcels add column fields_declaration_id uuid;
alter table parcels add column external_kultur_id text;
alter table parcels add column kultur_code text;
alter table parcels add column kultur_name_de text;
create unique index ux_parcels_season_lineage on parcels (season_year, fields_lineage_id)
  where fields_lineage_id is not null and deleted_at is null;
create index idx_parcels_category on parcels (season_year, category) where deleted_at is null;
