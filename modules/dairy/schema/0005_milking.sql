-- Milchwägung: Melkstand mit n Plätzen (Bank), die Tiere laufen der Reihe
-- nach am Lesegerät vorbei. Der Server (backend/app/reader.py) hält die
-- Leser-Verbindung unabhängig vom Browser und schreibt jede gelesene
-- Transpondernummer als Slot in die aktuell offene Bank; ist die Bank voll,
-- öffnet er automatisch die nächste. Der Client (Milchwägung-Seite) holt
-- die Slots per Sync, markiert gewogene Tiere, ordnet um und notiert.
alter table animals add column lauf_nr text;   -- "Laufnummer in Herde" (ADIS K01 283-286), gross auf dem Melkstand

create table milking_banks (
  id uuid primary key,
  session_date date not null,
  bank_number integer not null,
  capacity integer not null default 12,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_milking_banks_date on milking_banks (session_date, bank_number);

create table milking_slots (
  id uuid primary key,
  bank_id uuid not null references milking_banks(id),
  position integer not null,            -- aktuelle Reihenfolge (nach Umsortieren)
  original_position integer not null,   -- Reihenfolge, wie gelesen — bleibt sichtbar
  transponder text,                     -- Langform vom Leser (z.B. 756…)
  ear_tag text,                         -- aufgelöste Ohrmarke (CH…)
  animal_id uuid references animals(id),
  weighed boolean not null default false,
  notes text,
  read_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_milking_slots_bank on milking_slots (bank_id, position);

-- Journal je Tier — Notizen der Milchwägung werden hierher kopiert
-- (ref_id = Slot), manuelle Einträge später möglich.
create table animal_journal (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  entry_date date not null,
  source text not null default 'manual' check (source in ('manual', 'milchwaegung')),
  text text not null,
  ref_id uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_animal_journal_animal on animal_journal (animal_id, entry_date desc);
