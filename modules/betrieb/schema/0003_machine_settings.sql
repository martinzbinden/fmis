-- Einstellgrössen je Maschine (JSON [{key, label, unit, part}]) und das
-- Einstellprotokoll: welche Werte bei welchem Einsatz (Spur) galten.
alter table machines add column if not exists settings_def text;

create table if not exists machine_settings (
  id uuid primary key,
  machine_id uuid not null,
  track_id uuid,
  set_at timestamptz not null,
  settings text not null default '{}',   -- JSON {key: Zahl}
  crop text,                              -- Kultur / Sorte
  measured_kg_ha numeric,                 -- Abdrehprobe
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists machine_settings_machine_idx on machine_settings (machine_id, set_at);
