-- Behandlung/Beobachtung für ein Lamm ohne Ohrmarke (pages/Lambs.tsx): animal_id leer, Bezug auf
-- das Jungtier der Geburt. Wird die Ohrmarke nachgetragen (lib/earTagPending.ts), übernimmt das
-- Tier den Eintrag als Korrektur (corrects_id, schema/0014) — das Journal wird nur ergänzt.
alter table animal_journal add column offspring_id uuid references birth_offspring(id);
create index animal_journal_offspring on animal_journal (offspring_id) where offspring_id is not null;
