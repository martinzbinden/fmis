-- Rückimport aus dem AGFF-Wiesenjournal (frontend/src/agff/, tools/agff_journal.py): Spalten und Tabellen, die
-- dessen Seiten (Heute, Steckbrief, Jahr, Raster plus, Druck, Fragen) brauchen.

-- Parzellen: Stern im Finder, «immer zeigen» trotz kleiner Fläche, Name aus dem Import (Kurznamen)
alter table parcels add column if not exists favorit boolean not null default false;
alter table parcels add column if not exists immer_zeigen boolean not null default false;
alter table parcels add column if not exists name_import text;

-- Düngung: Fassinhalt der Gabe und «unvollständig» (Fahrt mit Lücken)
alter table fertilization_entries add column if not exists container_size numeric;
alter table fertilization_entries add column if not exists incomplete boolean not null default false;

-- Laufhof je Tierkategorie war ein Häkchen. Neu ein Zeichen: X = Weide, L = Laufhof, 0 = kein Auslauf,
-- leer = automatisch (aus Weide und Herden). Das Häkchen wurde von Hand gesetzt und hiess Laufhof → «L»;
-- kein Häkchen hiess «nicht erfasst» → automatisch, nicht «0». Text ohne Prüfung, damit ältere Geräte, die
-- noch true/false senden, nicht am Sync scheitern; gelesen wird 'true' als L, 'false' als automatisch.
alter table daily_farm_log alter column laufhof_kuehe type text using case when laufhof_kuehe then 'L' end;
alter table daily_farm_log alter column laufhof_rinder type text using case when laufhof_rinder then 'L' end;
alter table daily_farm_log alter column laufhof_kaelber type text using case when laufhof_kaelber then 'L' end;
alter table daily_farm_log alter column laufhof_galtkuehe type text using case when laufhof_galtkuehe then 'L' end;
alter table daily_farm_log alter column laufhof_schafe type text using case when laufhof_schafe then 'L' end;
alter table daily_farm_log alter column laufhof_legehennen type text using case when laufhof_legehennen then 'L' end;

-- Ausnahmen vom Auslauf (Einzeltier, Krankheit, Vogelgrippe …) je Kategorie und Zeitraum
create table if not exists auslauf_ausnahmen (
  id uuid primary key,
  kategorie text not null,
  grund text not null default 'andere',
  freitext text,
  anzahl integer,
  tier text,
  von date not null,
  bis date not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Betriebseinstellungen des Journals (kleine Parzellen, Schnellerfassung, Startansicht …), je Schlüssel eine Zeile.
-- id ist aus dem Schlüssel abgeleitet (agff/fmis/persist.ts), damit zwei Geräte dieselbe Zeile treffen.
create table if not exists journal_einstellungen (
  id uuid primary key,
  schluessel text not null,
  wert text,                -- Wert als JSON-Text
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
