-- Erinnerungen (Pendenzen) je Tier, z.B. eine geplante Folgebehandlung oder Kontrolle aus dem
-- Behandlungsformular (components/TreatmentForm.tsx). Erscheinen auf der Startseite «Heute» unter
-- Pendenzen, bis sie erledigt sind. case_id verbindet sie mit dem Behandlungsfall: eine dort
-- erfasste Folgebehandlung erledigt die offenen Erinnerungen des Falls.
-- Bewusst eine eigene Tabelle (nicht animal_journal): «erledigt» wird später gesetzt, das
-- Journal hat eine Korrekturfrist von 10 Minuten.
create table reminders (
  id uuid primary key,
  animal_id uuid not null references animals(id),
  case_id uuid,
  due_date date not null,
  title text not null,
  done_at timestamptz,
  done_by text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index reminders_open on reminders (due_date) where done_at is null and deleted_at is null;
create index reminders_case on reminders (case_id);
