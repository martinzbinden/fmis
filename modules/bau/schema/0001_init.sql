-- Bauprojekte: Projekte, Bauobjekte (Linie/Punkt/Fläche) und Messpunkte.
-- Läuft identisch in pglite (Client) und Postgres (Server); die PostGIS-
-- Umwandlung der Geometrie-Spalten liegt in schema/server/.

create table projects (
  id uuid primary key,
  name text not null,
  description text,
  status text not null default 'idee'
    check (status in ('idee', 'geplant', 'bewilligt', 'im_bau', 'abgeschlossen')),
  location text,
  start_date date,
  end_date date,
  contractor text,
  notes text,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table features (
  id uuid primary key,
  project_id uuid not null references projects(id),
  category text not null
    check (category in ('guelle', 'strom', 'wasser', 'abwasser', 'drainage', 'kommunikation',
                        'leerrohr', 'gebaeude', 'schacht', 'sonstiges')),
  status text not null default 'geplant'
    check (status in ('geplant', 'gebaut', 'eingemessen', 'verworfen')),
  label text,
  -- GeoJSON-Geometrie (Point, LineString, Polygon) als Text, WGS84
  geometry text,
  -- ursprüngliche Planlinie, falls die Geometrie durch Einmessen ersetzt wurde
  plan_geometry text,
  material text,
  diameter_mm numeric,
  depth_cm numeric,
  notes text,
  sort_order integer not null default 0,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_features_project on features (project_id);

create table survey_points (
  id uuid primary key,
  project_id uuid not null references projects(id),
  feature_id uuid references features(id),
  -- fortlaufende Punktnummer im Projekt (P001 …), für den Geometer
  point_no integer not null,
  -- Reihenfolge innerhalb des Objekts (Linie)
  seq integer not null default 0,
  lat double precision not null,
  lng double precision not null,
  accuracy_m numeric,
  altitude_m numeric,
  depth_cm numeric,
  note text,
  measured_at timestamptz not null,
  measured_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_survey_points_project on survey_points (project_id, point_no);
create index idx_survey_points_feature on survey_points (feature_id, seq);
