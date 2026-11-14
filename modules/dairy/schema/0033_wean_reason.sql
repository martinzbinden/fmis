-- Absetzen: Grund. «abgesetzt» (Normalfall) oder «weggenommen» (vor dem Absetzen von der Mutter getrennt, z.B. Eimer
-- oder Verkauf). Das Gewicht dieses Tages steht in animal_weights; daraus schätzt lib/lambMilk.ts die Milch.
alter table weanings add column reason text check (reason in ('abgesetzt', 'weggenommen'));
