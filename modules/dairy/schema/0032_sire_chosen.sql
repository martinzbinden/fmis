-- Geburt: der Vater wurde bei der Erfassung bewusst gewählt (nicht aus einem Import oder einer Vorbelegung).
-- Zusammen mit der Regel «Vater bei Geburt gewählt gilt als belegt» (Stall → Regeln) entscheidet das,
-- ob eine Geburt ohne passende Belegung als «Vater unklar» markiert wird (frontend/src/lib/sireCheck.ts).
alter table births add column sire_chosen boolean;
