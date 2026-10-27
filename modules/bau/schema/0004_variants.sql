-- Varianten eines Projekts (z.B. Trasse A entlang Strasse, B über die Parzelle): ein Objekt
-- gehört zu einer Variante (features.variant_id) oder zu allen (null, z.B. Gebäude, Schächte,
-- Anschlüsse). Die gewählte Variante steht beim Projekt; die übrigen gelten dann als
-- verworfen, bleiben aber erhalten. Karte, Einmessen und Export zeigen die gewählte Variante.
create table variants (
  id uuid primary key,
  project_id uuid not null references projects(id),
  name text not null,
  notes text,
  sort_order integer not null default 0,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table features add column variant_id uuid;
alter table projects add column chosen_variant_id uuid;
