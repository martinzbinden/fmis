-- Nach der Geburtserfassung (components/BirthFollowUp.tsx):
-- Vorauswahl je Jungtier. Es hat vielleicht noch keine Ohrmarke, darum der Bezug offspring_id und
-- animal_key leer, bis die Marke nachgetragen ist. purpose bleibt der endgültige Entscheid (der
-- Mastplaner liest ihn); leaning ist das Vorläufige und zählt nirgends als Entscheid.
alter table lamb_selection alter column animal_key drop not null;
alter table lamb_selection add column offspring_id uuid;
alter table lamb_selection add column leaning text check (leaning in ('eher_ja', 'eher_nein', 'spaeter'));
create index idx_lamb_selection_offspring on lamb_selection (offspring_id);

-- Ursache bei toten Jungtieren (lib/lambLoss.ts): defects = Schlüssel der Gebrechen, kommagetrennt.
alter table birth_offspring add column loss_cause text;
alter table birth_offspring add column defects text;
alter table birth_offspring add column loss_note text;
