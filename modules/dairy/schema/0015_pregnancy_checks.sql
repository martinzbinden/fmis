-- Trächtigkeitsuntersuchung (z.B. Ultraschall bei den Milchschafen): je Tier und Tag ein
-- Ergebnis ja/nein/unsicher, optional die geschätzte Trächtigkeitsdauer in Wochen.
-- Erfasst in FMIS (pages/PregnancyEntry.tsx), Tier per Ohrmarke oder Lesegerät.
create table pregnancy_checks (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  check_date date not null,
  result text not null check (result in ('ja', 'nein', 'unsicher')),
  weeks numeric,
  source text not null default 'manual' check (source in ('manual', 'reader')),
  notes text,
  recorded_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
