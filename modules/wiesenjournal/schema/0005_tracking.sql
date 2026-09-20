-- Traktor-Tracks (GPS-Aufzeichnung gefahrener Strecken/Flächen) und
-- Unkraut-Beobachtungen (Blacken/Disteln/andere, punktuell erfasst — manuell
-- oder als Vorschlag aus einer GPS-Verweilpause während einer laufenden
-- Track-Aufzeichnung). Geometrie hier bewusst noch als TEXT (GeoJSON) — wie
-- jede andere Tabelle vor der PostGIS-Umstellung, siehe schema/0001_init.sql
-- für die Begründung. Die Umwandlung auf echte PostGIS-Spalten passiert in
-- einer separaten schema/server/-Migration (server-only, siehe dort), damit
-- pglite (kein PostGIS) dieselbe Tabellendefinition weiterhin unverändert
-- übernehmen kann.

create table tracks (
  id uuid primary key,
  season_year integer not null,
  label text,
  started_at timestamptz not null,
  ended_at timestamptz,
  width_m numeric(5,2),
  geometry text,
  point_times text,
  point_count integer not null default 0,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_tracks_season on tracks (season_year) where deleted_at is null;

create table weed_observations (
  id uuid primary key,
  season_year integer not null,
  parcel_id uuid references parcels(id),
  track_id uuid references tracks(id),
  observed_at timestamptz not null,
  weed_type text not null check (weed_type in ('blacken', 'disteln', 'andere')),
  severity text check (severity in ('einzeln', 'nest', 'flaechig')),
  treatment text,
  treated_at date,
  source text not null default 'manual' check (source in ('manual', 'gps_dwell')),
  geometry text not null,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_weed_observations_season on weed_observations (season_year) where deleted_at is null;
