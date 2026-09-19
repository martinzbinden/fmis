-- Schreibbarer Planungs-Layer: unabhängig von den (schreibgeschützten)
-- importierten Kulturflächen bearbeitbare Parzellen (Geometrie + Kultur),
-- mit automatischer Versionierung. Jede Version ist eine eigene,
-- unveränderliche Zeile statt Update-in-place — "zurückspulen" bedeutet
-- schlicht, eine alte Version erneut als neue Version zu speichern
-- (siehe frontend/src/lib/planLayer.ts), nichts geht dabei verloren.
create table plan_parcels (
  id uuid primary key,                 -- eindeutig pro Version
  plan_id uuid not null,               -- verbindet alle Versionen "derselben" Planungsparzelle
  version_number integer not null,
  is_current boolean not null default true,
  farm_id uuid not null references farms(id),
  source_declaration_id uuid,          -- Herkunft: kopiert von dieser field_declarations-Zeile (null = von Grund auf gezeichnet)
  jahr integer not null,
  kultur_code text,
  kultur_name_de text,
  kultur_name_fr text,
  sorte text,
  flurname text,
  area_a numeric(8,2),
  -- GeoJSON, WGS84, als Text (nicht jsonb — vermeidet Adapter-Klippen
  -- zwischen psycopg3 und pglite beim Sync, siehe field_declarations.geometry).
  geometry text,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  -- Gesetzt auf der NEUEN (aktuellen) Version = "gelöscht" — auch das ist
  -- nur eine weitere Version, kein Löschen der Historie.
  deleted_at timestamptz
);
create index idx_plan_parcels_plan on plan_parcels (plan_id, version_number desc);
create index idx_plan_parcels_current on plan_parcels (farm_id, jahr) where is_current;

create view v_plan_parcels_current as
select * from plan_parcels where is_current and deleted_at is null;
