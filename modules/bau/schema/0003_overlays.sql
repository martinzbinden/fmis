-- Grundlagen für alle Projekte, z.B. Ebenen eines Leitungskataster-Auszugs (Abwasser,
-- Wasser, Elektro …): je Ebene ein eingepasstes, transparentes Bild in der Kartenprojektion.
-- Nur Anzeige, nicht bearbeitbar. Angaben synchronisiert, Bild nur auf dem Server
-- (server/0002_overlay_data.sql), Geräte laden es bei Bedarf (backend/app/overlays.py).
-- Hochladen als ZIP aus tools/leitungskataster_pdf.py.
create table overlays (
  id uuid primary key,
  group_id uuid not null,
  group_name text not null,
  kind text not null default 'leitungskataster',
  name text not null,
  color text,
  south double precision not null,
  west double precision not null,
  north double precision not null,
  east double precision not null,
  opacity real not null default 1,
  visible boolean not null default true,
  sort_order integer not null default 0,
  source text,
  size_bytes integer,
  created_by text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
