-- Merklisten: frei benannte Listen von Tieren (z.B. «Ausmerzen prüfen», «Klauen schneiden»).
-- Tiere kommen von Hand dazu oder aus einer Warnung bei der Erfassung (lib/animalWarnings.ts),
-- z.B. wenn ein als trächtig gemeldetes Tier belegt wird. reason hält fest, warum.
create table watchlists (
  id uuid primary key,
  name text not null,
  color text,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table watchlist_entries (
  id uuid primary key,
  list_id uuid not null references watchlists(id),
  animal_id uuid not null references animals(id),
  reason text,
  added_by text,
  added_at timestamptz not null default now(),
  done_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index watchlist_entries_list on watchlist_entries (list_id);
create index watchlist_entries_animal on watchlist_entries (animal_id);
