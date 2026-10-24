-- Arbeiten aus dem Arbeitsplan im Dienstplan: wer eine geplante Arbeit macht.
-- Die Arbeit selbst bleibt im Arbeitsplan (geplante Einträge im Wiesenjournal);
-- task_key = Schlüssel der Arbeit dort (Datum | Art | Dünger/Nutzung, lib/workPlan.ts).
-- Wird die Arbeit auf einen anderen Tag verschoben, entsteht ein neuer Schlüssel.
create table work_assignments (
  id uuid primary key,
  task_key text not null,
  task_date date not null,
  person_id uuid,
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_work_assignments_date on work_assignments (task_date) where deleted_at is null;
