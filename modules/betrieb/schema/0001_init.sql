-- Modul Betrieb: Maschinen (mit Dateien, Wartungsplan, Wartungsjournal,
-- Pendenzen), GPS-Spuren mit Güllefass-Ereignissen, Dienstplan. Bis
-- Oktober 2026 Teil des Wiesenjournals (wiesenjournal/schema/0005–0026);
-- der Server übernimmt die Bestandsdaten in schema/server/0004. Verweise
-- auf Parzellen (parcel_id) und von Düngungseinträgen auf Spuren
-- (wiesenjournal.fertilization_entries.track_id) sind lose, ohne
-- Fremdschlüssel über die Modulgrenze.

create table machines (
  id uuid primary key,
  name text not null,
  kind text not null default 'andere',
  capacity numeric,
  capacity_unit text check (capacity_unit in ('m3', 't', 'kg')),
  width_m numeric,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  manufacturer text,
  model text,
  type_no text,
  serial_no text,
  year_built integer,
  weight_kg numeric,
  power_hp numeric,
  front_pto boolean default false,
  tractor_id uuid,
  owner text,
  category text check (category in ('zugfahrzeug', 'anbaugeraet', 'anhaenger', 'auto', 'uebrige')),
  flow_m3_min numeric,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table machine_files (
  id uuid primary key,
  machine_id uuid not null,
  kind text not null default 'bild' check (kind in ('bild', 'anleitung', 'dokument')),
  title text,
  filename text not null,
  content_type text not null,
  size_bytes integer,
  source_url text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table maintenance_tasks (
  id uuid primary key,
  machine_id uuid not null,
  title text not null,
  task_type text not null default 'kontrolle' check (task_type in ('oel', 'filter', 'schmieren', 'kontrolle', 'verschleiss', 'service', 'andere')),
  interval_count numeric,
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
  entry_type text not null default 'wartung' check (entry_type in ('wartung', 'reparatur', 'kontrolle', 'zaehlerstand', 'beobachtung', 'schaden')),
  title text,
  task_ids text,
  counter numeric,
  cost_chf numeric,
  material text,
  done_by text,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_maintenance_log_machine on maintenance_log (machine_id, done_date);

create table machine_todos (
  id uuid primary key,
  machine_id uuid not null,
  title text not null,
  notes text,
  priority text not null default 'normal' check (priority in ('hoch', 'normal', 'tief')),
  due_date date,
  status text not null default 'offen' check (status in ('offen', 'erledigt')),
  done_date date,
  log_id uuid,
  done_log_id uuid,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_machine_todos_machine on machine_todos (machine_id, status);

-- geometry: Client GeoJSON-Text, Server PostGIS (schema/server/0001)
create table tracks (
  id uuid primary key,
  season_year integer not null,
  label text,
  started_at timestamptz not null,
  ended_at timestamptz,
  width_m numeric,
  geometry text,
  point_times text,
  point_count integer not null default 0,
  notes text,
  created_by text,
  work_type text,
  machine text,
  operator text,
  machine_id uuid,
  tractor_id uuid,
  guide_ref text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_tracks_season on tracks (season_year) where deleted_at is null;

create table tank_events (
  id uuid primary key,
  track_id uuid,
  machine_id uuid,
  parcel_id uuid,
  event_at timestamptz not null,
  source text not null default 'knopf' check (source in ('knopf', 'auto')),
  volume_m3 numeric not null,
  distance_m numeric not null,
  spread_s numeric not null,
  width_m numeric not null,
  lat double precision,
  lng double precision,
  notes text,
  unit text not null default 'm3' check (unit in ('m3', 't', 'kg')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_tank_events_machine on tank_events (machine_id, event_at);
create index idx_tank_events_track on tank_events (track_id);

create table duty_people (
  id uuid primary key,
  name text not null,
  email text,
  color text,
  active boolean not null default true,
  sort_order integer not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table duty_types (
  id uuid primary key,
  name text not null,
  start_time text not null,
  duration_min integer not null default 60,
  weekdays text not null default '1111111',
  color text,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table duty_skills (
  id uuid primary key,
  person_id uuid not null,
  type_id uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table duty_absences (
  id uuid primary key,
  person_id uuid not null,
  from_date date not null,
  to_date date not null,
  kind text not null default 'frei' check (kind in ('ferien', 'frei', 'krank', 'kurs', 'andere')),
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table duty_shifts (
  id uuid primary key,
  type_id uuid not null,
  date date not null,
  slot integer not null default 0,
  person_id uuid,
  notes text,
  assigned_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_duty_shifts_date on duty_shifts (date);

create table duty_changes (
  id uuid primary key,
  shift_id uuid not null,
  date date not null,
  type_id uuid not null,
  from_person uuid,
  to_person uuid,
  kind text not null check (kind in ('einteilen', 'tausch', 'abgabe', 'entfernt')),
  changed_by text,
  changed_at timestamptz not null default now(),
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Vorlage der Dienste (nur für neue Installationen; bestehende Daten kommen
-- per schema/server/0004). updated_at in der Vergangenheit: jede spätere
-- Änderung gewinnt gegen die Vorlage.
insert into duty_types (id, name, start_time, duration_min, weekdays, color, description, sort_order, updated_at) values
  ('d0000000-0000-4000-8000-000000000001', 'Melken Kühe morgens', '06:00', 90, '1111111', '#2563eb', null, 10, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000002', 'Melken Kühe abends', '17:00', 90, '1111111', '#1e3a8a', 'Uhrzeit noch bestätigen', 20, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000003', 'Melken Schafe morgens', '06:00', 75, '1111111', '#16a34a', 'Ausserhalb der Melksaison inaktiv setzen', 30, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000004', 'Schafmilch Käserei', '07:30', 60, '0100100', '#ea580c', 'Abfahrt 07:30', 40, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000005', 'Hühner', '13:00', 180, '1111111', '#ca8a04', 'Füttern, Eier ausnehmen. Notfalls ab 11 Uhr.', 50, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000006', 'Hühner misten', '13:00', 180, '0000010', '#a16207', '1× wöchentlich, gleiches Zeitfenster', 60, '2026-10-16T00:00:00Z')
on conflict (id) do nothing;
