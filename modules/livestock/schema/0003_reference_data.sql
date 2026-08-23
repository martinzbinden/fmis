-- Lokale, vom Betrieb gepflegte Referenzlisten für Medikamente (Absetzfrist)
-- und Futtermittel (Gehalte). Es gibt keine offizielle Schnittstelle für
-- automatische Aktualisierung (siehe Konversation) — diese Tabellen werden
-- über normale Formulare (upsertRow/softDeleteRow) manuell gepflegt und
-- treiben nur die Autocomplete-Vorschläge beim Erfassen.
create table medication_reference (
  id uuid primary key,
  name text not null,
  active_ingredient text,
  default_withdrawal_days integer not null default 0,
  notes text,
  verified_at date,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table feed_reference (
  id uuid primary key,
  name text not null,
  supplier text,
  crude_protein_pct numeric(5,2),
  energy_mj numeric(5,2),
  crude_fiber_pct numeric(5,2),
  crude_ash_pct numeric(5,2),
  crude_fat_pct numeric(5,2),
  calcium_pct numeric(5,3),
  phosphorus_pct numeric(5,3),
  sodium_pct numeric(5,3),
  notes text,
  verified_at date,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
