-- Ablammung/Abkalbung erfassen, bevor die Ohrmarken gesetzt sind: lebende Nachkommen
-- dürfen ohne ear_tag gespeichert werden und gelten als Pendenz «Ohrmarke nachtragen»
-- (pages/EarTagPending.tsx), bis die Ohrmarke eingetragen ist. Stirbt ein Nachkomme
-- vorher, schliesst died_on die Pendenz (verendet ohne Ohrmarke).
alter table birth_offspring add column died_on date;
