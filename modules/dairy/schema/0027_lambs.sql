-- Lämmer (pages/Lambs.tsx, lib/lambs.ts): Absetzen, Gewichte, Fütterung.
-- Absetzen: eigene Zeile je Jungtier (einmaliger Eintrag mit Korrekturfrist, die Geburt bleibt
-- unverändert). Solange keine da ist und das Jungtier jung ist, saugt es noch und seine Mutter
-- gilt als «mit Lämmern» — unabhängig davon, in welcher Tiergruppe beide stehen.
create table weanings (
  id uuid primary key,
  offspring_id uuid references birth_offspring(id),
  animal_id uuid references animals(id),
  wean_date date not null,
  herd_group text,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (animal_id is not null or offspring_id is not null)
);
create index idx_weanings_offspring on weanings (offspring_id);
create index idx_weanings_animal on weanings (animal_id);

-- Gewichte je Jungtier. Es hat vielleicht noch keine Ohrmarke: dann nur offspring_id, sonst
-- animal_id (und offspring_id, wenn es aus einer erfassten Geburt stammt).
create table animal_weights (
  id uuid primary key,
  animal_id uuid references animals(id),
  offspring_id uuid references birth_offspring(id),
  weigh_date date not null,
  weight_kg numeric(5,1) not null check (weight_kg > 0),
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (animal_id is not null or offspring_id is not null)
);
create index idx_animal_weights_animal on animal_weights (animal_id, weigh_date desc);
create index idx_animal_weights_offspring on animal_weights (offspring_id, weigh_date desc);

-- Fütterung im Journal (z.B. Schoppen). Drenchen und Boli sind Behandlungen (Behandlungsjournal).
alter table animal_journal drop constraint if exists animal_journal_category_check;
alter table animal_journal add constraint animal_journal_category_check
  check (category in ('notiz', 'beobachtung', 'krankheit', 'behandlung', 'brunst', 'klauen', 'trocken', 'fuetterung'));
