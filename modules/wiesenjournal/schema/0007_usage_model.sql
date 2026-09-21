-- Nutzungsmodell nach der Legende des Papier-/Excel-Wiesenjournals:
-- Weide je Tierkategorie (X Kühe, Y Rinder, Z Kälber, G Galtkühe, W Schafe,
-- V Legehennen; Kleinbuchstabe = nur Tagweide), Schnitte (S Silage, Db/Du
-- Dürrfutter belüftet/unbelüftet), Pflegemassnahmen (P Weide putzen, B/BE/BF
-- Blacken, Ü Übersaat, H Aufwuchshöhe) und Feldarbeiten. Mehrere Einträge
-- pro Parzelle und Tag sind normal (z.B. Kühe und Schafe am selben Tag).
alter table usage_entries drop constraint if exists usage_entries_usage_type_check;
update usage_entries set usage_type = 'weide' where usage_type = 'weide_anzahl';
alter table usage_entries add constraint usage_entries_usage_type_check check (usage_type in (
  'weide', 'eingrasen', 'silage', 'duerrfutter_bel', 'duerrfutter_unbel',
  'weide_putzen', 'blacken_stechen', 'blacken_einzelstock', 'blacken_flaeche',
  'uebersaat', 'aufwuchshoehe', 'pflug', 'saat', 'striegeln', 'saeuberungsschnitt', 'sonstig'));
alter table usage_entries add column animal_category text;
alter table usage_entries add constraint usage_entries_animal_category_check
  check (animal_category is null or animal_category in ('kuehe', 'rinder', 'kaelber', 'galtkuehe', 'schafe', 'legehennen'));
alter table usage_entries add column day_only boolean not null default false;
alter table usage_entries add column label text;              -- Freitext (sonstig), Mischung (uebersaat/saat)
alter table usage_entries add column value_num numeric(10,2); -- Aufwuchshöhe cm, Saatmenge kg/ha
alter table usage_entries add column yield_amount numeric(10,2);
alter table usage_entries add column yield_unit text;
alter table usage_entries add constraint usage_entries_yield_unit_check
  check (yield_unit is null or yield_unit in ('rb', 'fu', 'st', 'kg', 'dt_ts'));
-- Idempotenz-Schlüssel des Excel-Imports (tools/import_wiesenjournal_xlsx.py)
alter table usage_entries add column import_key text;
