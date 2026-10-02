-- Zusatzfelder für den Prüfbericht (Ergebnisse der Milchleistungskontrolle)
-- aus dem Herdebuch-Export: K33 (Milchprobe) und K04 (Laktation), Positionen
-- in frontend/src/lib/importAdis.ts.
alter table milk_tests add column milk_morning_kg numeric(4,1);   -- K33 130–133
alter table milk_tests add column milk_evening_kg numeric(4,1);   -- K33 134–137
alter table milk_tests add column sample_persistency integer;     -- K33 106–108, Proben-Persistenz %
alter table milk_tests add column bhb_mmol numeric(4,2);          -- K33 188–191
alter table milk_tests add column acetone_mmol numeric(4,2);      -- K33 184–187 (Aceton IR)
alter table lactations add column cell_count integer;             -- K04 114–118, Zellzahl der Laktation
alter table lactations add column persistency integer;            -- K04 122–124, Laktations-Persistenz %
