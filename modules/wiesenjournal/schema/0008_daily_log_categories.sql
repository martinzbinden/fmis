-- Laufhof je Tierkategorie (Excel-Zeilen "Laufhof" X/Y/Z/V/W) und Tierzahlen.
alter table daily_farm_log add column laufhof_kaelber boolean;
alter table daily_farm_log add column laufhof_galtkuehe boolean;
alter table daily_farm_log add column laufhof_schafe boolean;
alter table daily_farm_log add column laufhof_legehennen boolean;
-- JSON-Text {"kuehe": 20, "galtkuehe": 2, ...} — bewusst text statt jsonb
-- (siehe data_history.snapshot, gleiches Muster).
alter table daily_farm_log add column animal_counts text;
