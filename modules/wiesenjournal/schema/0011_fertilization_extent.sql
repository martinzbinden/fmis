-- Düngungsmassnahme mit Flächenbezug und Nährstoffen.
-- extent_type: parcel = ganze Journal-Parzelle (parcel_id), parcels = mehrere
-- Parzellen (Anteile in fertilization_shares), polygon = frei gezeichnete
-- Fläche (Zaunstreifen, Rand, oben/unten — darf GELAN-Grenzen überschreiten),
-- track = GPS-Traktorfahrt (tracks) mit Arbeitsbreite gepuffert (Server).
-- area_a/n_kg/... = Totale der Massnahme; die Verteilung auf GELAN-Parzellen
-- steht in fertilization_shares (Client rechnet sie für parcel/parcels
-- offline, für polygon/track liefert POST /wiesenjournal/fertilization/
-- resolve-extent die PostGIS-Verschneidung).
alter table fertilization_entries alter column parcel_id drop not null;
alter table fertilization_entries add column fertilizer_type_id uuid;   -- soft FK auf fertilizer_types (bewusst ohne Constraint, Pull-Reihenfolge)
alter table fertilization_entries add column dilution text;             -- wie erfasst, z.B. '1:1', '3:1' (Gülle:Wasser)
alter table fertilization_entries add column dilution_factor numeric(5,3);  -- Gülle-Anteil, null = Typ-Default
alter table fertilization_entries add column container_count numeric(6,2);  -- Fass/Fuder
alter table fertilization_entries add column extent_type text not null default 'parcel';
alter table fertilization_entries add constraint fertilization_entries_extent_check
  check (extent_type in ('parcel', 'parcels', 'polygon', 'track'));
alter table fertilization_entries add column track_id uuid references tracks(id);
alter table fertilization_entries add column track_width_m numeric(5,2);
alter table fertilization_entries add column geometry text;             -- GeoJSON-Text; Server: PostGIS via schema/server/0003
alter table fertilization_entries add column area_a numeric(10,2);      -- effektiv gedüngte Fläche (Aren)
alter table fertilization_entries add column n_kg numeric(10,2);
alter table fertilization_entries add column n_avail_kg numeric(10,2);
alter table fertilization_entries add column p2o5_kg numeric(10,2);
alter table fertilization_entries add column k2o_kg numeric(10,2);
alter table fertilization_entries add column import_key text;

create table fertilization_shares (
  id uuid primary key,
  entry_id uuid not null references fertilization_entries(id),
  parcel_id uuid not null references parcels(id),
  area_a numeric(10,2) not null,
  n_kg numeric(10,2),
  n_avail_kg numeric(10,2),
  p2o5_kg numeric(10,2),
  k2o_kg numeric(10,2),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_fert_shares_entry on fertilization_shares (entry_id) where deleted_at is null;
create index idx_fert_shares_parcel on fertilization_shares (parcel_id) where deleted_at is null;
