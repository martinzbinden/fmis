-- Modul Tiere: Herdengruppen über alle Tierarten (Milchkühe, Milchschafe,
-- Mastplaner), ihre Standorte (Ställe, Weiden, Alp) mit Laufhof, Aufenthalte,
-- Mitglieder, Bestände und Laufhof-Journal (RAUS). Bis Oktober 2026 Teil
-- des Wiesenjournals (wiesenjournal/schema/0017, 0018); der Server übernimmt
-- die Bestandsdaten in schema/server/0001. Verweise auf Parzellen
-- (herd_stays.parcel_id) und Tiere anderer Module (herd_members) sind lose.

create table locations (
  id uuid primary key,
  name text not null,
  site text,
  kind text not null default 'stall' check (kind in ('stall', 'weide', 'alp', 'andere')),
  sort_order integer not null default 0,
  active boolean not null default true,
  notes text,
  laufhof text not null default 'keiner' check (laufhof in ('keiner', 'staendig', 'zeitweise')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table herd_groups (
  id uuid primary key,
  name text not null,
  species text not null default 'schafe' check (species in ('schafe', 'rinder')),
  milking boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table herd_stays (
  id uuid primary key,
  group_id uuid not null,
  slot text not null check (slot in ('stall', 'weide')),
  location_id uuid,
  parcel_id uuid,
  day_only boolean not null default false,
  from_date date not null,
  to_date date,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_herd_stays_group on herd_stays (group_id, slot, from_date);

create table herd_members (
  id uuid primary key,
  group_id uuid not null,
  module_key text not null,
  animal_id uuid not null,
  label text,
  category text not null,
  from_date date not null,
  to_date date,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_herd_members_group on herd_members (group_id);
create index idx_herd_members_animal on herd_members (animal_id, from_date);

create table herd_counts (
  id uuid primary key,
  group_id uuid not null,
  category text not null,
  count integer not null check (count >= 0),
  from_date date not null,
  to_date date,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_herd_counts_group on herd_counts (group_id, category);

create table herd_laufhof (
  id uuid primary key,
  group_id uuid not null,
  entry_date date not null,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_herd_laufhof_date on herd_laufhof (entry_date, group_id);
