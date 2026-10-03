-- Herdengruppen und Standorte: wer steht wo (Wiesenjournal → Herden).
--
-- - locations: feste Orte (Ställe, Alp) — Weiden sind die Parzellen.
-- - herd_groups: eine Gruppe Tiere, die zusammen steht und gezügelt wird.
--   milking = gemolkene Gruppe; wer sie verlässt, wird (mit Rückfrage)
--   trockengestellt.
-- - herd_stays: Aufenthalte einer Gruppe, je Platz unabhängig: 'stall'
--   (Ort, ändert selten, bis zum Umzug) und 'weide' (Parzelle oder Ort,
--   kann täglich wechseln; Gruppen ohne Stall sind nur auf der Weide).
--   to_date = letzter Tag (inklusive), null = bis heute.
-- - herd_members: Einzeltiere aus den Tiermodulen (module_key + animal_id,
--   lose Verknüpfung wie animal_group im Journal) mit Kategorie.
-- - herd_counts: Tiere ohne Nummer je Kategorie — für Gruppen, deren Tiere
--   (noch) nicht einzeln bekannt sind.
-- Die Weide im Journal-Raster wird aus herd_stays + Bestand abgeleitet
-- (frontend/src/lib/herds.ts), nicht mehr je Tag erfasst.

create table locations (
  id uuid primary key,
  name text not null,
  site text,
  kind text not null default 'stall' check (kind in ('stall', 'weide', 'alp', 'andere')),
  sort_order integer not null default 0,
  active boolean not null default true,
  notes text,
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

create index idx_herd_stays_group on herd_stays (group_id, slot, from_date);
create index idx_herd_members_animal on herd_members (animal_id, from_date);
create index idx_herd_members_group on herd_members (group_id);
create index idx_herd_counts_group on herd_counts (group_id, category);

insert into locations (id, name, site, kind, sort_order) values
 ('72000000-0000-0000-0000-000000000001', 'Melkstall Schafe', 'Oberer Riedacker', 'stall', 10),
 ('72000000-0000-0000-0000-000000000002', 'Bei Hühnerstall', 'Oberer Riedacker', 'stall', 20),
 ('72000000-0000-0000-0000-000000000003', 'Schopf', 'Oberer Riedacker', 'stall', 30),
 ('72000000-0000-0000-0000-000000000004', 'Kuhstall', 'Unterer Riedacker', 'stall', 40),
 ('72000000-0000-0000-0000-000000000005', 'Multifunktionsstall Maschinenschopf', 'Unterer Riedacker', 'stall', 50),
 ('72000000-0000-0000-0000-000000000006', 'Kälberstall Tiefstreue', 'Unterer Riedacker', 'stall', 60),
 ('72000000-0000-0000-0000-000000000007', 'Kälberstall Boxen', 'Unterer Riedacker', 'stall', 70),
 ('72000000-0000-0000-0000-000000000008', 'Lämmerstall', 'Unterer Riedacker', 'stall', 80),
 ('72000000-0000-0000-0000-000000000009', 'Alp Lischboden', 'Alp Lischboden', 'alp', 90)
on conflict (id) do nothing;
