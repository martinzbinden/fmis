-- Dienstplan: wer melkt, füttert, fährt in die Käserei — und ist jede
-- Arbeit an jedem Tag abgedeckt? Personen (mit Verknüpfung zum FMIS-Konto
-- über die E-Mail), Diensttypen (Uhrzeit, Dauer, Wochentage — jederzeit
-- änderbar), Fähigkeiten (wer welchen Dienst machen kann), Abwesenheiten,
-- eingeteilte Dienste und ein Änderungsprotokoll (Tausch/Abgabe sichtbar
-- für alle). Ein Dienst hat eine feste id aus Typ + Datum + Platz, damit
-- zwei Geräte denselben Platz nicht doppelt belegen.

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
  -- HH:MM Ortszeit
  start_time text not null,
  duration_min integer not null default 60,
  -- je Wochentag Mo..So die Anzahl Plätze, z.B. '1111111' oder '0100100'
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

-- Vorlage nach Angaben vom 14.10.2026 (änderbar). updated_at bewusst in der
-- Vergangenheit: spätere Änderungen gewinnen immer gegen diese Vorlage.
insert into duty_types (id, name, start_time, duration_min, weekdays, color, description, sort_order, updated_at) values
  ('d0000000-0000-4000-8000-000000000001', 'Melken Kühe morgens', '06:00', 90, '1111111', '#2563eb', null, 10, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000002', 'Melken Kühe abends', '17:00', 90, '1111111', '#1e3a8a', 'Uhrzeit noch bestätigen', 20, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000003', 'Melken Schafe morgens', '06:00', 75, '1111111', '#16a34a', 'Ausserhalb der Melksaison inaktiv setzen', 30, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000004', 'Schafmilch Käserei', '07:30', 60, '0100100', '#ea580c', 'Abfahrt 07:30', 40, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000005', 'Hühner', '13:00', 180, '1111111', '#ca8a04', 'Füttern, Eier ausnehmen. Notfalls ab 11 Uhr.', 50, '2026-10-16T00:00:00Z'),
  ('d0000000-0000-4000-8000-000000000006', 'Hühner misten', '13:00', 180, '0000010', '#a16207', '1× wöchentlich, gleiches Zeitfenster', 60, '2026-10-16T00:00:00Z');
