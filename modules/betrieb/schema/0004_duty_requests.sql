-- Dienstplan: Freiwünsche und Vorschläge (Abgabe, Tausch) der Mitarbeitenden.
-- Der Plan ändert sich erst, wenn das Büro (betrieb:dienste:write) bestätigt;
-- bis dahin ist es nur ein Antrag. Mitarbeitende schreiben ausschliesslich in
-- diese Tabelle (Bereich betrieb:wuensche), nie in duty_shifts.
--
--   wunsch   Freiwunsch für from_date..to_date → bei Bestätigung entsteht eine Abwesenheit «frei»
--   abgabe   eigenen Dienst (shift_id) abgeben, optional an to_person
--   tausch   eigenen Dienst (shift_id) gegen other_shift_id von to_person tauschen
-- shift_id ist die feste Platz-id (Typ + Datum + Platz, lib/duty.ts shiftId) und
-- gilt auch, wenn der Platz noch keine Zeile in duty_shifts hat.
create table duty_requests (
  id uuid primary key,
  kind text not null check (kind in ('wunsch', 'abgabe', 'tausch')),
  person_id uuid not null,
  shift_id uuid,
  date date,
  type_id uuid,
  to_person uuid,
  other_shift_id uuid,
  other_date date,
  other_type_id uuid,
  from_date date,
  to_date date,
  notes text,
  status text not null default 'offen' check (status in ('offen', 'bestaetigt', 'abgelehnt', 'zurueckgezogen')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_duty_requests_status on duty_requests (status) where deleted_at is null;
