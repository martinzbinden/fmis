-- Dienstplan: Standard-Wochenpläne (Vorlagen) mit Versionen und Wochenstatus.
--
-- duty_templates        ein Standardplan; gilt ab valid_from, bis ein späterer Plan beginnt
--                       (Wechsel «ab Datum xy» = neue Version, die alte bleibt erhalten).
--                       cycle_weeks > 1: Rotation über mehrere Wochen (Woche A/B …).
-- duty_template_slots   wer in welcher Woche des Zyklus, an welchem Wochentag, welchen Platz
--                       eines Dienstes macht (person_id leer = offen).
-- duty_weeks            Status je Kalenderwoche: aus der Vorlage als Entwurf erzeugt, vom Büro
--                       bestätigt (spätestens 2 Monate im Voraus). Die Dienste selbst liegen
--                       weiterhin in duty_shifts.
create table duty_templates (
  id uuid primary key,
  name text not null,
  valid_from date not null,
  cycle_weeks integer not null default 1 check (cycle_weeks between 1 and 8),
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table duty_template_slots (
  id uuid primary key,
  template_id uuid not null,
  week_no integer not null default 0 check (week_no between 0 and 7),
  weekday integer not null check (weekday between 0 and 6),
  type_id uuid not null,
  slot integer not null default 0,
  person_id uuid,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_duty_template_slots_template on duty_template_slots (template_id) where deleted_at is null;

create table duty_weeks (
  id uuid primary key,
  week_start date not null,
  status text not null default 'entwurf' check (status in ('entwurf', 'bestaetigt')),
  generated_at timestamptz,
  confirmed_by text,
  confirmed_at timestamptz,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_duty_weeks_start on duty_weeks (week_start) where deleted_at is null;
