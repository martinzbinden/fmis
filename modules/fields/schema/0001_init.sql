-- Betriebe, Bewirtschaftungseinheiten und Kulturflächen aus dem kantonalen
-- "Raumdatenexport Bewirtschafter" (jährlich, ESRISHAPE/GeoPackage-Format).
-- Zwei Betriebe (Betriebszweiggemeinschaft/ÖLN-Gemeinschaft) teilen sich
-- diese Datenbank und eine gemeinsame Karte, bleiben aber über `farm_id`
-- klar getrennt (u.a. für die separate Jahresabrechnung je Betrieb).

create table farms (
  id uuid primary key,
  external_uid text,     -- 'UID' aus dem Export, z.B. CHE113280045
  bur_nr text,            -- 'BUR_NR'
  name text not null,     -- 'Name' aus betrieb_betrieb, z.B. "Wyden"
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table management_units (
  id uuid primary key,
  farm_id uuid not null references farms(id),
  external_id text not null,   -- 'ID BewE'
  jahr integer not null,
  gemeinde_bfs_nr text,
  zone text,
  name text,
  area_total_a numeric(8,2),   -- 'Fl Total' (Aren)
  area_unprod_a numeric(8,2),
  area_wald_a numeric(8,2),
  area_land_a numeric(8,2),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_management_units_farm on management_units (farm_id, jahr);

create table field_declarations (
  id uuid primary key,
  farm_id uuid not null references farms(id),
  -- Verbindet dieselbe physische Parzelle über mehrere Jahre (siehe
  -- README): beim Re-Import über external_kultur_id abgeglichen, bei
  -- manueller Zukunftsplanung von der Basis-Deklaration übernommen.
  lineage_id uuid not null,
  management_unit_external_id text,   -- 'ID BewE', informativer Link
  external_kultur_id text,            -- 'ID Kultur' aus Import, null bei rein manuell geplanten Zeilen
  jahr integer not null,
  sequence_in_year integer not null default 1,  -- 1=Hauptkultur, 2+=Zwischenfutter/Folgekultur
  kultur_code text not null,
  kultur_name_de text,
  kultur_name_fr text,
  flurname text,
  area_a numeric(8,2),                -- 'Fl_Land' (Aren)
  baeume integer,
  -- GeoJSON (Polygon/MultiPolygon/Point), WGS84, als JSON-Text (bewusst
  -- NICHT jsonb — vermeidet Adapter-Klippen zwischen psycopg3 und pglite
  -- beim generischen Push/Pull, siehe data_history.snapshot in
  -- schema/0002_history.sql für dasselbe Muster). Client parst/serialisiert
  -- selbst (JSON.parse/JSON.stringify) beim Rendern bzw. Schreiben.
  geometry text,
  source text not null default 'import' check (source in ('import', 'plan')),
  notes text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_field_declarations_farm_year on field_declarations (farm_id, jahr);
create index idx_field_declarations_lineage on field_declarations (lineage_id, jahr);

-- Jüngste Zeile je Parzellen-Linie — Basis für die Fruchtfolge-Übersicht
-- (Titel/aktuelle Kultur pro Linie), siehe pages/Rotation.tsx.
create view v_field_lineage_summary as
select distinct on (lineage_id)
  lineage_id, farm_id, flurname, kultur_code, kultur_name_de, jahr as latest_jahr
from field_declarations
where deleted_at is null
order by lineage_id, jahr desc, sequence_in_year desc;
