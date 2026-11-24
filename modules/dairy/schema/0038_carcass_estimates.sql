-- Schlachtwert Rindvieh (lib/carcassValue.ts): eigene Schätzungen je Tier, die jüngste zählt.
-- kind 'gewicht': Messband (Brustumfang girth_cm → Lebendgewicht) oder Auge (Lebend- oder Schlachtgewicht, basis).
--   Wägungen mit der Waage stehen in animal_weights (wie bei den Lämmern).
-- kind 'chtax': Fleischigkeit (C H + T - A X) und Fettklasse (1–5), z.B. mit dem Bilder-Assistenten.
create table carcass_estimates (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  estimate_date date not null,
  kind text not null check (kind in ('gewicht', 'chtax')),
  method text check (method in ('messband', 'auge')),
  basis text check (basis in ('lg', 'sg')),
  weight_kg numeric(6,1) check (weight_kg > 0),
  girth_cm numeric(5,1) check (girth_cm > 0),
  fleshiness text check (fleshiness in ('C', 'H', '+', 'T', '-', 'A', 'X')),
  fat_class smallint check (fat_class between 1 and 5),
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_carcass_estimates_animal on carcass_estimates (animal_id, estimate_date desc);
