-- Wartungsjournal: Beobachtungen und Schäden als Einträge, Pendenzen
-- (offene Aufgaben) je Maschine — aus einem Eintrag heraus oder einzeln;
-- beim Erledigen optional als Reparatur ins Journal (done_log_id).

alter table maintenance_log drop constraint if exists maintenance_log_entry_type_check;
alter table maintenance_log add constraint maintenance_log_entry_type_check
  check (entry_type in ('wartung', 'reparatur', 'kontrolle', 'zaehlerstand', 'beobachtung', 'schaden'));

create table machine_todos (
  id uuid primary key,
  machine_id uuid not null,
  title text not null,
  notes text,
  priority text not null default 'normal' check (priority in ('hoch', 'normal', 'tief')),
  due_date date,
  status text not null default 'offen' check (status in ('offen', 'erledigt')),
  done_date date,
  -- Eintrag, aus dem die Pendenz entstand (Beobachtung/Schaden)
  log_id uuid,
  -- Eintrag beim Erledigen (Reparatur)
  done_log_id uuid,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_machine_todos_machine on machine_todos (machine_id, status);
