-- Trockenstellen als Journal-Kategorie 'trocken' (Datum = entry_date). Ein
-- Tier gilt als trocken, wenn der neueste 'trocken'-Eintrag nach der letzten
-- Geburt liegt (frontend/src/lib/dryOff.ts) — die nächste Geburt beendet es
-- von selbst. Erfasst beim Zügeln aus einer gemolkenen Herdengruppe
-- (Wiesenjournal → Herden) oder von Hand im Tierjournal.
alter table animal_journal drop constraint if exists animal_journal_category_check;
alter table animal_journal add constraint animal_journal_category_check
  check (category in ('notiz', 'beobachtung', 'krankheit', 'behandlung', 'brunst', 'klauen', 'trocken'));
