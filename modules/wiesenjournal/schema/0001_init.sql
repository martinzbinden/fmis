-- Wiesenjournal: digitales Pendant zum Papier-Wiesenjournal (Nutzung/
-- Düngung pro Parzelle/Tag, Weidegang-Geometrie, Tagesmeldungen). Eigenes
-- Postgres-Schema 'wiesenjournal', unabhängig von modules/fields — Module
-- sind isoliert (eigenes Schema/eigener Pool je Modul, siehe
-- core/backend/fmis_core/db.py), eine SQL-FK über Modulgrenzen hinweg ist
-- nicht möglich. Referenzen auf Tiere/Gruppen aus livestock/dairy sind
-- deshalb bewusst lose Text-Felder (animal_group), keine FK.

-- Parzellen-Stammdaten, pro Saison neu erfasst (wie field_declarations.jahr
-- im fields-Modul) — keine saisonübergreifende lineage_id in v1.
create table parcels (
  id uuid primary key,
  season_year integer not null,
  name text not null,
  area_a numeric(8,2),
  wiesentyp text,
  intensitaet text check (intensitaet in ('i', 'wi', 'e', 'mi')),
  base_geometry text,   -- optionaler Referenz-Umriss (GeoJSON als TEXT, siehe field_declarations.geometry), NICHT massgeblich für die Weidegang-Grenze
  sort_order integer not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_parcels_season on parcels (season_year) where deleted_at is null;

-- Versionierte, freiform gezeichnete Weidegang-/Zaun-Geometrie — dieselbe
-- "jede Änderung ist eine neue unveränderliche Version"-Logik wie
-- modules/fields/schema/0005_plan_layer.sql (plan_parcels): eine Bearbeitung
-- setzt is_current=false auf der alten Zeile und fügt eine neue Version ein,
-- nichts wird je in-place überschrieben. Das IST die Tier-Standort-/
-- Ist-Zustand-Antwort (kein Join nötig): animal_group + geometry direkt hier.
create table paddocks (
  id uuid primary key,
  paddock_id uuid not null,
  version_number integer not null,
  is_current boolean not null default true,
  parcel_id uuid references parcels(id),
  season_year integer not null,
  valid_from date not null,
  valid_to date,
  animal_group text,
  geometry text not null,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_paddocks_thread on paddocks (paddock_id, version_number desc);
create index idx_paddocks_current on paddocks (season_year) where is_current;
create view v_paddocks_current as
  select * from paddocks where is_current and deleted_at is null;

-- Nutzung: ein Eintrag pro Weide-/Eingrasen-Ereignis an einem Tag.
create table usage_entries (
  id uuid primary key,
  parcel_id uuid not null references parcels(id),
  entry_date date not null,
  usage_type text not null check (usage_type in ('weide', 'weide_anzahl', 'eingrasen')),
  animal_count integer,
  animal_group text,
  paddock_version_id uuid references paddocks(id),
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_usage_entries_parcel_date on usage_entries (parcel_id, entry_date);

-- Düngung: ein Eintrag pro Ausbringung an einem Tag.
create table fertilization_entries (
  id uuid primary key,
  parcel_id uuid not null references parcels(id),
  entry_date date not null,
  duengung_code text not null check (duengung_code in ('RGv', 'RGk', 'RMI', 'RMs', 'SG', 'SM', 'A', 'H', 'V')),
  amount numeric(10,2),
  unit text not null default 'm3' check (unit in ('m3', 't', 'kg')),
  gabe_number integer,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_fert_entries_parcel_date on fertilization_entries (parcel_id, entry_date);

-- Stickstoff-Zusammenfassung pro Parzelle+Gabe (Applikationsrunde) — die
-- rechte Spaltengruppe des Papierformulars. Eine Gabe kann mehrere
-- fertilization_entries umfassen, deshalb eine eigene Tabelle statt Spalten
-- auf fertilization_entries.
create table n_dose_summary (
  id uuid primary key,
  parcel_id uuid not null references parcels(id),
  season_year integer not null,
  gabe_number integer not null,
  guelle_verduennung text,
  n_planned_kg numeric(8,2),
  n_actual_kg numeric(8,2),
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_n_dose_parcel on n_dose_summary (parcel_id, gabe_number);

-- Betriebsweite Tagesmeldung (Laufhof/Auslauf + Wetter/Niederschlag/Mond) —
-- eine Zeile pro Tag, kein Bezug zu einer Parzelle.
create table daily_farm_log (
  id uuid primary key,
  entry_date date not null,
  laufhof_kuehe boolean,
  laufhof_rinder boolean,
  wetter_code text,
  niederschlag_mm numeric(6,1),
  mond_phase text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index idx_daily_farm_log_date on daily_farm_log (entry_date) where deleted_at is null;
