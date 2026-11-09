-- Begleitung und Arbeiten ausserhalb der Dienste (pages/Duty.tsx, Woche → Kalender).
-- companion: Person, die begleitet (Praktikum, Schnupperlehre) — im Dienst dabei, zählt aber nicht
-- als Besetzung und kommt nicht aus der Wochenvorlage.
alter table duty_people add column companion boolean not null default false;

-- Wer einen Dienst begleitet: je Tag und Dienst (unabhängig vom Platz der Stammperson).
create table duty_companions (
  id uuid primary key,
  date date not null,
  type_id uuid not null,
  person_id uuid not null,
  notes text,
  assigned_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_duty_companions_date on duty_companions (date) where deleted_at is null;

-- Arbeiten ausserhalb der Dienste, für alle Mitarbeitenden. Ohne Uhrzeit = irgendwann am Tag.
create table duty_tasks (
  id uuid primary key,
  date date not null,
  start_time text,
  duration_min integer,
  title text not null,
  person_id uuid,
  notes text,
  assigned_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_duty_tasks_date on duty_tasks (date) where deleted_at is null;
