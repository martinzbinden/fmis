-- Journal nur ergänzend führen: eine Korrektur ist ein NEUER Eintrag, der auf
-- den korrigierten verweist (corrects_id). Der alte Eintrag bleibt unverändert
-- stehen und gilt ab dann als «korrigiert» (abgeleitet: es gibt einen
-- Eintrag, der auf ihn zeigt). Folgebehandlungen und Verlaufsbeobachtungen
-- eines kranken Tieres sind neue Einträge mit derselben case_id (Fall).
alter table animal_journal add column corrects_id uuid;
create index animal_journal_corrects on animal_journal (corrects_id) where corrects_id is not null;
create index animal_journal_case on animal_journal (case_id) where case_id is not null;
