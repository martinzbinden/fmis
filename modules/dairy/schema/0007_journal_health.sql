-- Tierjournal mit Kategorien und Behandlungsangaben — deckt das
-- Behandlungsjournal ab (Datum, Tier, Diagnose, Medikament, Dosis,
-- Absetzfristen Milch/Fleisch, wer behandelt hat). Offene Milch-Absetzfrist
-- = entry_date + withdrawal_milk_days >= heute (Warnung in Tierdetail und
-- Milchwägung). Bestehende Einträge (Milchwägungs-Notizen) werden 'notiz'.
-- Bewusst OHNE not null: ein noch nicht aktualisiertes Gerät schreibt beim
-- Sync die Zeile ohne diese Spalte (= null) — das darf nicht scheitern;
-- leer gilt als 'notiz'.
alter table animal_journal add column category text default 'notiz'
  check (category in ('notiz', 'beobachtung', 'krankheit', 'behandlung', 'brunst', 'klauen'));
alter table animal_journal add column diagnosis text;
alter table animal_journal add column medication text;
alter table animal_journal add column dose text;
alter table animal_journal add column withdrawal_milk_days integer;
alter table animal_journal add column withdrawal_meat_days integer;
alter table animal_journal add column administered_by text;
