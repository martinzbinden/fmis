-- Arbeiten planen über Parzellen hinaus (pages/WorkPlan.tsx, components/TaskCreateDialog.tsx): an und mit Tieren
-- (Einzeltiere, Tiergruppen), Gebäuden, Maschinen, Brennholz und frei erfasste Arbeiten. Parzellen-Arbeiten bleiben
-- geplante Einträge im Wiesenjournal (is_planned).
--
-- targets: JSON-Liste der Ziele, z.B.
--   [{"kind":"tier","module":"dairy_schafe","id":"…","label":"101 · 9999.0001"},
--    {"kind":"gruppe","id":"…","label":"Galtschafe"},
--    {"kind":"maschine","id":"…","label":"Mähwerk"},
--    {"kind":"objekt","label":"Schafstall"}]
-- Erledigt schreibt je nach Zielen ins Stalljournal (Tiere, Milchmodule), ins Betriebsjournal (farm_journal) und bei
-- Maschinen zusätzlich ins Maschinenjournal (maintenance_log); journal_refs hält fest, wohin.
create table work_tasks (
  id uuid primary key,
  title text not null,
  area text not null check (area in ('tiere', 'gebaeude', 'maschine', 'brennholz', 'frei')),
  targets text not null default '[]',
  planned_date date,
  due_date date,
  person_id uuid,
  quantity numeric,
  unit text,
  notes text,
  -- Herkunft: manuell oder eine Shop-Bestellung (Etappe Shop)
  source text not null default 'manuell',
  source_ref text,
  customer text,
  status text not null default 'offen' check (status in ('offen', 'erledigt', 'abgesagt')),
  done_date date,
  done_by text,
  result_notes text,
  journal_refs text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_work_tasks_open on work_tasks (planned_date) where deleted_at is null and status = 'offen';

-- Betriebsjournal: erledigte Arbeiten an Gebäuden, Maschinen, Brennholz, freie Arbeiten (und Tierarbeiten ohne
-- Stalljournal, z.B. Mastlämmer). Auch direkt erfassbar ohne Plan.
create table farm_journal (
  id uuid primary key,
  entry_date date not null,
  area text not null,
  title text not null,
  targets text not null default '[]',
  quantity numeric,
  unit text,
  notes text,
  task_id uuid,
  customer text,
  done_by text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_farm_journal_date on farm_journal (entry_date) where deleted_at is null;
