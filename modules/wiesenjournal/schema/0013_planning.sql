-- Planungseinträge ("Arbeit planen") für heute und künftige Tage: dieselbe
-- Tabelle, nur mit is_planned=true markiert, damit sie im Raster auffällig
-- umrahmt werden (siehe components/JournalGridClassic.tsx) und beim
-- Bearbeiten über "Eintrag speichern" in einen definitiven Eintrag
-- übergehen (is_planned wird dabei auf false gesetzt).
alter table usage_entries add column is_planned boolean not null default false;
alter table fertilization_entries add column is_planned boolean not null default false;
