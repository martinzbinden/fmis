-- Pro-Modul-Instanz-Einstellungen für die APR600-Ohrmarkenleser-Integration
-- (siehe core/backend/fmis_core/agrident.py). Eigene Tabelle statt Erweiterung
-- der generischen `modules`-Tabelle, weil nur dairy/dairy_schafe/livestock
-- jemals einen Leser haben werden — fields/wiesenjournal sollen dafür keine
-- (immer leeren) Spalten tragen müssen.

create table reader_settings (
  module_key text primary key references modules(key),
  enabled boolean not null default false,
  host text not null default '192.168.0.111',
  port integer not null default 2010,
  updated_at timestamptz not null default now()
);

-- Titel-Korrektur: die Module heissen "Milchkühe"/"Milchschafe" (werden
-- später breitere Funktionen als nur Milchleistung erhalten), nicht mehr
-- "Milchleistung ...".
update modules set title = 'Milchkühe' where key = 'dairy';
update modules set title = 'Milchschafe' where key = 'dairy_schafe';

-- Aktuell haben nur die Schafe einen Ohrmarkenchip, die Kühe (noch) nicht;
-- livestock (Mastplaner) nutzt den Leser für den Datenpool-Import.
insert into reader_settings (module_key, enabled) values
  ('dairy', false),
  ('dairy_schafe', true),
  ('livestock', true)
on conflict (module_key) do nothing;
