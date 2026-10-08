-- Behandlungsjournal nach den Mindestanforderungen der amtlichen Kontrolle
-- (TAMV Art. 28): erste und letzte Anwendung, Tier, Indikation, Handelsname,
-- Menge, Absetzfristen, Freigabedatum Milch/Fleisch, anwendende Person,
-- Abgabestelle. Ein Fall mit mehreren Präparaten = mehrere Zeilen mit
-- derselben case_id.
--
-- Absetzfrist = Tage ab letzter Anwendung × withdrawal_factor (2 = doppelt,
-- Bio). release_*_date = erster Tag, an dem Milch/Fleisch wieder geliefert
-- werden darf — beim Speichern berechnet bzw. aus cownect übernommen, damit
-- das Journal den damals gültigen Stand zeigt.
--
-- Behandlungen von Tieren ausserhalb der Herde (Kälber, abgegangene Tiere)
-- aus dem cownect-Import: animal_id leer, ear_tag/animal_name gesetzt.
alter table animal_journal alter column animal_id drop not null;
alter table animal_journal add column ear_tag text;
alter table animal_journal add column animal_name text;
alter table animal_journal add column treatment_time text;
alter table animal_journal add column last_date date;
alter table animal_journal add column applications integer;
alter table animal_journal add column supplier text;
alter table animal_journal add column body_system text;
alter table animal_journal add column withdrawal_factor integer;
alter table animal_journal add column release_milk_date date;
alter table animal_journal add column release_meat_date date;
alter table animal_journal add column critical_antibiotic boolean;
alter table animal_journal add column antibiogram boolean;
alter table animal_journal add column case_id uuid;
alter table animal_journal add column import_key text;
create unique index animal_journal_import_key on animal_journal (import_key) where import_key is not null;

alter table animal_journal drop constraint if exists animal_journal_source_check;
alter table animal_journal add constraint animal_journal_source_check
  check (source in ('manual', 'milchwaegung', 'import'));

-- Favoriten: typische Behandlungen (ein oder mehrere Präparate) zum
-- Vorausfüllen. items = JSON [{medication, dose, applications, days,
-- milk_days, meat_days}], days = Behandlungsdauer in Tagen.
create table treatment_templates (
  id uuid primary key,
  title text not null,
  body_system text,
  diagnosis text,
  items text not null default '[]',
  supplier text,
  notes text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
