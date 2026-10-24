-- Schon gemeldete Hinweise des Stundenplan-Abgleichs (backend/app/school_timetable.py),
-- damit das Büro jeden nur einmal bekommt.
create table school_notices (
  key text primary key,
  created_at timestamptz not null default now()
);
