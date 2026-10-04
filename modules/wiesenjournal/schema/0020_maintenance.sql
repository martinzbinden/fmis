-- Wartungsjournal für alle Maschinen (Wiesenjournal → Maschinen → Wartung).
--
-- - machines.category: Kategorie-Knopf, null = automatisch nach Art
--   (lib/maintenance.ts categoryOf): zugfahrzeug, anbaugeraet, anhaenger,
--   auto, uebrige.
-- - maintenance_tasks: Wartungsplan je Maschine — Intervall in Zählereinheit
--   (Betriebsstunden, bei Autos km) und/oder Monaten. template_key = aus
--   welcher Vorlage (lib/maintenanceTemplates.ts), null = selbst erfasst.
-- - maintenance_log: Journal — ein Eintrag = ein Ereignis (Service,
--   Reparatur, Kontrolle, Zählerstand) mit Datum, Zählerstand, Kosten; hakt
--   eine oder mehrere Aufgaben ab (task_ids = JSON-Text-Array, wie
--   daily_farm_log.animal_counts).

alter table machines add column category text
  check (category in ('zugfahrzeug', 'anbaugeraet', 'anhaenger', 'auto', 'uebrige'));

create table maintenance_tasks (
  id uuid primary key,
  machine_id uuid not null,
  title text not null,
  task_type text not null default 'kontrolle'
    check (task_type in ('oel', 'filter', 'schmieren', 'kontrolle', 'verschleiss', 'service', 'andere')),
  interval_count numeric(10,1),
  interval_months integer,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  template_key text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_maintenance_tasks_machine on maintenance_tasks (machine_id);

create table maintenance_log (
  id uuid primary key,
  machine_id uuid not null,
  done_date date not null,
  entry_type text not null default 'wartung'
    check (entry_type in ('wartung', 'reparatur', 'kontrolle', 'zaehlerstand')),
  title text,
  task_ids text,
  counter numeric(10,1),
  cost_chf numeric(10,2),
  material text,
  done_by text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_maintenance_log_machine on maintenance_log (machine_id, done_date);
