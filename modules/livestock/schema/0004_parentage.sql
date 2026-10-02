-- Abstammung eigener Lämmer, die aus der Selektion der Milchschafe
-- (dairy_schafe.lamb_selection, purpose = 'mast') übernommen werden — siehe
-- frontend/src/lib/ownLambs.ts. Zugekaufte Tiere bleiben ohne Eltern.
alter table animals add column dam_ear_tag text;
alter table animals add column sire_ear_tag text;
